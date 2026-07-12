import './config/loadEnv.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import ruleset from './rules/ucs-opd-v1.json' assert { type: 'json' };
import { RulesEngine } from './services/RulesEngine.js';
import { ValidationService } from './services/ValidationService.js';
import { DemoClaimRepository } from './repositories/DemoClaimRepository.js';
import { HosxpRepository } from './repositories/HosxpRepository.js';
import { ClaimWorkflowService } from './services/ClaimWorkflowService.js';
import { SystemSettingsService } from './services/SystemSettingsService.js';
import { AuthService } from './services/AuthService.js';
import { GovernanceService } from './services/GovernanceService.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const configuredRuleset = structuredClone(ruleset);
const ucsCodes = String(process.env.HOSXP_UCS_PTTYPE_CODES ?? '').split(',').map(value => value.trim()).filter(Boolean);
if (ucsCodes.length) configuredRuleset.rules.find(rule => rule.id === 'UCS-003').value = ucsCodes;
const dataSource = process.env.CLAIM_DATA_SOURCE === 'hosxp' ? 'hosxp' : 'demo';
const repository = dataSource === 'hosxp' ? new HosxpRepository({
  host: process.env.HOSXP_DB_HOST, port: Number(process.env.HOSXP_DB_PORT ?? 3306), database: process.env.HOSXP_DB_NAME,
  user: process.env.HOSXP_DB_USER, password: process.env.HOSXP_DB_PASSWORD, ssl: process.env.HOSXP_DB_SSL === 'true'
}) : new DemoClaimRepository();
export const governance = new GovernanceService({ repository, ruleset: configuredRuleset });
const service = new ValidationService({ repository, engine: new RulesEngine(configuredRuleset), ruleset: configuredRuleset, governance });
export const workflow = new ClaimWorkflowService({ validationService: service });
export const systemSettings = new SystemSettingsService();
export const auth = new AuthService();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  if (chunks.reduce((size, chunk) => size + chunk.length, 0) > 1_000_000) throw Object.assign(new Error('Request body too large'), { status: 413 });
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function range(url) { return { from: url.searchParams.get('from'), to: url.searchParams.get('to') }; }
function validationOptions(url) { return { ...range(url), page: url.searchParams.get('page'), pageSize: url.searchParams.get('pageSize'), q: url.searchParams.get('q') }; }
function cookies(request) { return Object.fromEntries(String(request.headers.cookie ?? '').split(';').filter(Boolean).map(item => { const index = item.indexOf('='); return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))]; })); }
function secureCookie(request) { return request.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production' ? '; Secure' : ''; }

export async function handler(request, response) {
  const url = new URL(request.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return json(response, 200, { status: 'ok', service: 'MedClaim Hub', version: '0.4.0', dataSource });
    if (url.pathname === '/api/v1/auth/mock/login' && request.method === 'POST') { const result = auth.loginMock((await body(request)).role); return json(response, 200, { user: result.user, expiresAt: result.expiresAt, mode: 'provider_id_mock' }, { 'set-cookie': `mch_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secureCookie(request)}` }); }
    const sessionToken = cookies(request).mch_session;
    if (url.pathname === '/api/v1/auth/logout' && request.method === 'POST') { auth.logout(sessionToken); return json(response, 200, { status: 'logged_out' }, { 'set-cookie': `mch_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookie(request)}` }); }
    const user = url.pathname.startsWith('/api/v1/') ? auth.authenticate(sessionToken) : null;
    if (url.pathname === '/api/v1/auth/me') return json(response, 200, { user, mode: 'provider_id_mock' });
    const requirePermission = permission => auth.authorize(user, permission);
    if (url.pathname === '/api/v1/settings' && request.method === 'GET') { requirePermission('settings:manage'); return json(response, 200, systemSettings.getPublicSettings()); }
    if (url.pathname === '/api/v1/settings' && request.method === 'PUT') { requirePermission('settings:manage'); return json(response, 200, systemSettings.update(await body(request))); }
    if (url.pathname === '/api/v1/settings/database/test' && request.method === 'POST') { requirePermission('settings:manage'); return json(response, 200, await systemSettings.testDatabase()); }
    if (url.pathname === '/api/v1/settings/database/schema' && request.method === 'GET') { requirePermission('settings:manage'); if (!repository.inspectSchema) throw Object.assign(new Error('กรุณาเปิด CLAIM_DATA_SOURCE=hosxp'), { status: 400, code: 'HOSXP_NOT_ENABLED' }); return json(response, 200, { database: process.env.HOSXP_DB_NAME, columns: await repository.inspectSchema() }); }
    if (url.pathname === '/api/v1/dashboard') return json(response, 200, await workflow.dashboard(range(url)));
    if (url.pathname === '/api/v1/validate/ucs') return json(response, 200, await service.validateUcs(validationOptions(url)));
    const claimDetail = url.pathname.match(/^\/api\/v1\/claims\/([A-Za-z0-9_-]+)$/);
    if (claimDetail && request.method === 'GET') { requirePermission('claims:read'); return json(response, 200, await repository.findVisitDetail(claimDetail[1])); }
    if (url.pathname === '/api/v1/governance/auth-ambiguities' && request.method === 'GET') { requirePermission('auth:read'); return json(response, 200, await governance.listAmbiguities(validationOptions(url))); }
    const authCandidates = url.pathname.match(/^\/api\/v1\/governance\/auth-ambiguities\/([A-Za-z0-9_-]+)$/);
    if (authCandidates && request.method === 'GET') { requirePermission('auth:resolve'); return json(response, 200, await governance.candidates(authCandidates[1])); }
    if (authCandidates && request.method === 'POST') { requirePermission('auth:resolve'); return json(response, 200, await governance.resolve(authCandidates[1], (await body(request)).claimCode, user)); }
    if (url.pathname === '/api/v1/governance/rules' && request.method === 'GET') { requirePermission('rules:read'); return json(response, 200, governance.listRules()); }
    if (url.pathname === '/api/v1/governance/rules' && request.method === 'POST') { requirePermission('rules:approve'); return json(response, 201, governance.createDraft(await body(request), user)); }
    const ruleAction = url.pathname.match(/^\/api\/v1\/governance\/rules\/([^/]+)\/(submit|approve|reject)$/);
    if (ruleAction && request.method === 'POST') { requirePermission('rules:approve'); return json(response, 200, governance.transition(ruleAction[1], ruleAction[2], user)); }
    if (url.pathname === '/api/v1/batches' && request.method === 'GET') return json(response, 200, workflow.listBatches());
    if (url.pathname === '/api/v1/batches' && request.method === 'POST') { requirePermission('batches:create'); return json(response, 201, await workflow.createBatch(await body(request))); }
    const submit = url.pathname.match(/^\/api\/v1\/batches\/([^/]+)\/submit$/);
    if (submit && request.method === 'POST') { requirePermission('batches:submit'); return json(response, 200, workflow.submitBatch(submit[1])); }
    if (url.pathname === '/api/v1/responses' && request.method === 'GET') return json(response, 200, workflow.listResponses());
    if (url.pathname === '/api/v1/responses/import' && request.method === 'POST') { requirePermission('responses:manage'); const input = await body(request); return json(response, 201, workflow.importResponse(input.batchId, input.result)); }
    const appeal = url.pathname.match(/^\/api\/v1\/responses\/([^/]+)\/appeal$/);
    if (appeal && request.method === 'POST') { requirePermission('responses:manage'); return json(response, 200, workflow.appealResponse(appeal[1])); }
    if (url.pathname === '/api/v1/reconciliation' && request.method === 'GET') return json(response, 200, workflow.reconciliation());
    if (url.pathname === '/api/v1/reconciliation' && request.method === 'POST') { requirePermission('reconciliation:manage'); return json(response, 201, workflow.recordPayment(await body(request))); }
    if (url.pathname === '/api/v1/report') return json(response, 200, await workflow.report(range(url)));
  } catch (error) {
    return json(response, error.status ?? 500, { error: error.code ?? 'INTERNAL_ERROR', message: error.message });
  }
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = normalize(join(root, requested));
  if (!file.startsWith(root)) return json(response, 403, { error: 'FORBIDDEN' });
  try {
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    json(response, 404, { error: 'NOT_FOUND' });
  }
}

export function start(port = Number(process.env.PORT ?? 4100)) {
  return createServer(handler).listen(port, '127.0.0.1', () => console.log(`MedClaim Hub: http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
