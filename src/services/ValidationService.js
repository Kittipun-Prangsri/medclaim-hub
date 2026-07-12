export class ValidationService {
  constructor({ repository, engine, ruleset, governance = null }) {
    Object.assign(this, { repository, engine, ruleset, governance });
  }

  async validateUcs(range) {
    const records = await this.repository.findUcsVisits(range);
    const pagination = records.pagination ?? { page: 1, pageSize: records.length, total: records.length, totalPages: 1 };
    const cases = records.map(sourceRecord => {
      const record = this.governance?.applyResolution(sourceRecord) ?? sourceRecord;
      const issues = this.engine.validate(record);
      const status = issues.some(i => i.severity === 'critical') ? 'blocked' : issues.length ? 'warning' : 'ready';
      return { ...record, status, issues };
    });
    const summary = cases.reduce((result, item) => ({ ...result, [item.status]: result[item.status] + 1 }), {
      totalVisits: cases.length, ready: 0, warning: 0, blocked: 0
    });
    return { dataSource: this.repository.sourceName ?? 'unknown', truncated: pagination.total > pagination.pageSize, pagination, ruleset: this.ruleset.id, rulesetVersion: this.ruleset.version, dateFrom: range.from, dateTo: range.to, summary, cases };
  }
}
