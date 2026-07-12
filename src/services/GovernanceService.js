export class GovernanceService {
  constructor({ repository, ruleset, clock = () => new Date().toISOString() }) {
    this.repository = repository; this.clock = clock; this.resolutions = new Map(); this.sequence = 1;
    this.rulesets = [{ id: ruleset.id, version: ruleset.version, status: 'approved', rulesCount: ruleset.rules.length, createdAt: this.clock(), approvedAt: this.clock(), actor: 'system' }];
  }
  applyResolution(record) { const item = this.resolutions.get(record.vn); return item ? { ...record, authCode: item.claimCode, authResolution: 'manual' } : record; }
  async listAmbiguities(options) { return this.repository.findAuthAmbiguities ? this.repository.findAuthAmbiguities(options) : { cases: [], pagination: { page: 1, total: 0, totalPages: 0 } }; }
  async candidates(vn) { if (!this.repository.findAuthCandidates) throw this.error('แหล่งข้อมูลนี้ไม่มี Auth Code candidates', 'NOT_SUPPORTED', 400); return this.repository.findAuthCandidates(vn); }
  async resolve(vn, claimCode, actor) { const data = await this.candidates(vn); if (!data.candidates.includes(claimCode)) throw this.error('Claim Code ไม่อยู่ใน candidates ของ visit นี้', 'INVALID_CLAIM_CODE', 400); const result = { vn, claimCode, actor: actor.providerId, actorName: actor.name, resolvedAt: this.clock() }; this.resolutions.set(vn, result); return { ...result, claimCode: this.mask(claimCode) }; }
  listRules() { return [...this.rulesets].reverse(); }
  createDraft({ version, note = '' }, actor) { if (!/^\d+\.\d+\.\d+$/.test(String(version))) throw this.error('Version ต้องเป็นรูปแบบ x.y.z', 'INVALID_VERSION', 400); if (this.rulesets.some(item => item.version === version)) throw this.error('Version นี้มีอยู่แล้ว', 'DUPLICATE_VERSION', 400); const draft = { id: `RULE-DRAFT-${this.sequence++}`, version, note: String(note).slice(0, 500), status: 'draft', rulesCount: this.rulesets[0].rulesCount, createdAt: this.clock(), actor: actor.providerId }; this.rulesets.push(draft); return draft; }
  transition(id, action, actor) { const item = this.rulesets.find(rule => rule.id === id); if (!item) throw this.error('ไม่พบ ruleset', 'RULESET_NOT_FOUND', 404); const allowed = { submit: ['draft', 'in_review'], approve: ['in_review', 'approved'], reject: ['in_review', 'rejected'] }; const timestamps = { submit: 'submittedAt', approve: 'approvedAt', reject: 'rejectedAt' }; const [from, to] = allowed[action] ?? []; if (item.status !== from) throw this.error(`สถานะ ${item.status} ไม่สามารถ ${action} ได้`, 'INVALID_RULE_STATUS', 400); item.status = to; item[timestamps[action]] = this.clock(); item.lastActor = actor.providerId; return item; }
  mask(value) { const text = String(value); return text.length <= 4 ? '••••' : `${'•'.repeat(Math.min(8, text.length - 4))}${text.slice(-4)}`; }
  error(message, code, status) { const error = new Error(message); Object.assign(error, { code, status }); return error; }
}
