import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceService } from '../src/services/GovernanceService.js';

const actor = { providerId: 'P001', name: 'Reviewer' };
const ruleset = { id: 'MCH_UCS_OPD_V1', version: '1.0.0', rules: [{ id: 'R1' }] };

test('resolves only a Claim Code returned by HOSxP candidates', async () => {
  const repository = { findAuthCandidates: async () => ({ candidates: ['CODE-A', 'CODE-B'] }) };
  const service = new GovernanceService({ repository, ruleset, clock: () => '2026-07-12T00:00:00.000Z' });
  await assert.rejects(service.resolve('VN1', 'BAD', actor), error => error.code === 'INVALID_CLAIM_CODE');
  const result = await service.resolve('VN1', 'CODE-A', actor);
  assert.notEqual(result.claimCode, 'CODE-A');
  assert.equal(service.applyResolution({ vn: 'VN1', authCode: '' }).authCode, 'CODE-A');
});

test('rules follow draft, review, and approval states', () => {
  const service = new GovernanceService({ repository: {}, ruleset, clock: () => '2026-07-12T00:00:00.000Z' });
  const draft = service.createDraft({ version: '1.1.0', note: 'เพิ่มกฎ' }, actor);
  assert.equal(draft.status, 'draft');
  assert.ok(service.transition(draft.id, 'submit', actor).submittedAt);
  const approved = service.transition(draft.id, 'approve', actor);
  assert.equal(approved.status, 'approved');
  assert.ok(approved.approvedAt);
});

test('cannot approve a draft before review', () => {
  const service = new GovernanceService({ repository: {}, ruleset });
  const draft = service.createDraft({ version: '2.0.0' }, actor);
  assert.throws(() => service.transition(draft.id, 'approve', actor), error => error.code === 'INVALID_RULE_STATUS');
});
