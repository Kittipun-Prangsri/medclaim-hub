export function getPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function thaiCitizenId(value) {
  if (!/^\d{13}$/.test(String(value ?? ''))) return false;
  const digits = String(value).split('').map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (13 - index), 0);
  return (11 - (sum % 11)) % 10 === digits[12];
}

const operators = {
  required: value => value !== null && value !== undefined && String(value).trim() !== '',
  in: (value, expected) => expected.includes(value),
  greaterThan: (value, expected) => Number(value) > Number(expected),
  thaiCitizenId
};

export class RulesEngine {
  constructor(ruleset) {
    this.ruleset = ruleset;
  }

  validate(record) {
    return this.ruleset.rules.flatMap(rule => {
      const operator = operators[rule.operator];
      if (!operator) throw new Error(`Unsupported operator: ${rule.operator}`);
      return operator(getPath(record, rule.field), rule.value) ? [] : [{
        ruleId: rule.id,
        field: rule.field,
        severity: rule.severity,
        message: rule.message
      }];
    });
  }
}
