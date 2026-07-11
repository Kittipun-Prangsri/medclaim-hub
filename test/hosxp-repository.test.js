import test from 'node:test';
import assert from 'node:assert/strict';
import { HosxpRepository } from '../src/repositories/HosxpRepository.js';

test('maps HOSxP query result to claim records', async () => {
  let captured;
  const pool = { execute: async (sql, params) => { if (sql.startsWith('SELECT COUNT')) return [[{ total: 1 }]]; captured = { sql, params }; return [[{
    vn: 'VN001', hn: 'HN001', serviceDate: '2026-07-11', citizenId: '1101700203450', patientName: 'ผู้ป่วย ทดสอบ',
    pttype: '01', mainDiagnosis: 'J00', authCode: '', amount: '125.50'
  }]]; } };
  const repository = new HosxpRepository({ database: 'hos' }, { pool });
  const rows = await repository.findUcsVisits({ from: '2026-07-01', to: '2026-07-11' });
  assert.equal(rows[0].amount, 125.5);
  assert.deepEqual(captured.params, ['2026-07-01', '2026-07-11', '2026-07-01', '2026-07-11', 1000, 0]);
  assert.match(captured.sql, /FROM ovst o/);
  assert.match(captured.sql, /LIMIT \? OFFSET \?/);
  assert.match(captured.sql, /HAVING COUNT\(DISTINCT claimcode\) = 1/);
  assert.deepEqual(rows.pagination, { page: 1, pageSize: 1000, total: 1, totalPages: 1, query: '' });
});

test('uses parameterized server-side search for HN, VN, CID and name', async () => {
  const calls = [];
  const pool = { execute: async (sql, params) => { calls.push({ sql, params }); return sql.startsWith('SELECT COUNT') ? [[{ total: 0 }]] : [[]]; } };
  const repository = new HosxpRepository({ database: 'hos' }, { pool });
  const rows = await repository.findUcsVisits({ from: '2026-07-01', to: '2026-07-11', q: 'HN001', page: 2, pageSize: 50 });
  assert.match(calls[0].sql, /o\.vn = \?/);
  assert.ok(calls.every(call => !call.sql.includes('HN001')));
  assert.deepEqual(calls[0].params.slice(2), ['HN001', 'HN001', 'HN001', '%HN001%', '%HN001%']);
  assert.equal(rows.pagination.query, 'HN001');
});

test('rejects a HOSxP query range over 31 days', async () => {
  const repository = new HosxpRepository({ database: 'hos' }, { pool: { execute: async () => [[]] } });
  await assert.rejects(
    repository.findUcsVisits({ from: '2026-01-01', to: '2026-03-01' }),
    error => error.code === 'DATE_RANGE_TOO_LARGE'
  );
});

test('schema mismatch returns a safe actionable error', async () => {
  const cause = Object.assign(new Error('bad field'), { code: 'ER_BAD_FIELD_ERROR', sqlMessage: "Unknown column 'sum_price'" });
  const repository = new HosxpRepository({ database: 'hos' }, { pool: { execute: async () => { throw cause; } } });
  await assert.rejects(
    repository.findUcsVisits({ from: '2026-07-01', to: '2026-07-11' }),
    error => error.code === 'HOSXP_SCHEMA_MISMATCH' && !error.message.includes('password')
  );
});
