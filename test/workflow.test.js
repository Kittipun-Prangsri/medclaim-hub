import test from 'node:test';
import assert from 'node:assert/strict';
import ruleset from '../src/rules/ucs-opd-v1.json' with { type: 'json' };
import { RulesEngine } from '../src/services/RulesEngine.js';
import { ValidationService } from '../src/services/ValidationService.js';
import { ClaimWorkflowService } from '../src/services/ClaimWorkflowService.js';
import { DemoClaimRepository } from '../src/repositories/DemoClaimRepository.js';

function createWorkflow() {
  const validationService = new ValidationService({ repository: new DemoClaimRepository(), engine: new RulesEngine(ruleset), ruleset });
  return new ClaimWorkflowService({ validationService, clock: () => '2026-07-11T08:00:00.000Z' });
}

test('complete accepted claim workflow through reconciliation', async () => {
  const workflow = createWorkflow();
  const batch = await workflow.createBatch({ name: 'UCS OPD รอบเช้า', visitIds: ['6907110001'] });
  assert.equal(batch.status, 'draft');
  assert.equal(batch.claimedAmount, 860);

  workflow.submitBatch(batch.id);
  const response = workflow.importResponse(batch.id, 'accepted');
  assert.equal(response.approvedAmount, 817);

  const payment = workflow.recordPayment({ responseId: response.id, paidAmount: 817, reference: 'BANK-001' });
  assert.equal(payment.difference, 0);
  assert.equal(workflow.reconciliation()[0].status, 'reconciled');

  const dashboard = await workflow.dashboard({});
  assert.deepEqual(dashboard.finance, { claimed: 860, approved: 817, paid: 817, outstanding: 0 });
  assert.deepEqual(dashboard.claimTrend, [
    { date: '2026-07-10', total: 1, ready: 0, issues: 1, amount: 540 },
    { date: '2026-07-11', total: 3, ready: 1, issues: 2, amount: 4250 }
  ]);
});

test('rejected response can be appealed', async () => {
  const workflow = createWorkflow();
  const batch = await workflow.createBatch({ name: 'UCS OPD รอบบ่าย', visitIds: ['6907110001'] });
  workflow.submitBatch(batch.id);
  const response = workflow.importResponse(batch.id, 'rejected');
  assert.equal(workflow.appealResponse(response.id).status, 'appealed');
  assert.equal(workflow.listBatches()[0].status, 'appealed');
});

test('blocked visit cannot be added to a batch', async () => {
  const workflow = createWorkflow();
  await assert.rejects(
    workflow.createBatch({ name: 'รอบข้อมูลผิด', visitIds: ['6907110002'] }),
    error => error.code === 'CLAIMS_NOT_READY'
  );
});
