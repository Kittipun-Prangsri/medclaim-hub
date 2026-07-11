function round(value) { return Math.round(Number(value) * 100) / 100; }

export class ClaimWorkflowService {
  constructor({ validationService, clock = () => new Date().toISOString() }) {
    this.validationService = validationService;
    this.clock = clock;
    this.batches = [];
    this.responses = [];
    this.payments = [];
    this.audit = [];
    this.sequence = 1;
  }

  async dashboard(range = {}) {
    const validation = await this.validationService.validateUcs(range);
    const trendByDate = validation.cases.reduce((days, item) => {
      const day = days.get(item.serviceDate) ?? { date: item.serviceDate, total: 0, ready: 0, issues: 0, amount: 0 };
      day.total += 1;
      day.amount = round(day.amount + item.amount);
      if (item.status === 'ready') day.ready += 1; else day.issues += 1;
      days.set(item.serviceDate, day);
      return days;
    }, new Map());
    const claimed = this.batches.reduce((sum, batch) => sum + batch.claimedAmount, 0);
    const approved = this.responses.reduce((sum, item) => sum + item.approvedAmount, 0);
    const paid = this.payments.reduce((sum, item) => sum + item.paidAmount, 0);
    return {
      dataSource: validation.dataSource,
      truncated: validation.truncated,
      validation: validation.summary,
      claimTrend: [...trendByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      finance: { claimed: round(claimed), approved: round(approved), paid: round(paid), outstanding: round(approved - paid) },
      batches: this.batches.length,
      rejected: this.responses.filter(item => item.status === 'rejected').length,
      recentActivity: this.audit.slice(-6).reverse()
    };
  }

  async createBatch({ name, visitIds }) {
    const validation = await this.validationService.validateUcs({});
    const selected = validation.cases.filter(item => visitIds.includes(item.vn));
    if (!name?.trim()) throw this.error('กรุณาระบุชื่อรอบส่ง', 'NAME_REQUIRED');
    if (!selected.length) throw this.error('กรุณาเลือกรายการอย่างน้อย 1 รายการ', 'VISITS_REQUIRED');
    const invalid = selected.filter(item => item.status !== 'ready');
    if (invalid.length) throw this.error(`มี ${invalid.length} รายการที่ยังไม่พร้อมส่ง`, 'CLAIMS_NOT_READY');
    const duplicate = selected.find(item => this.batches.some(batch => batch.visitIds.includes(item.vn)));
    if (duplicate) throw this.error(`VN ${duplicate.vn} อยู่ในรอบส่งแล้ว`, 'DUPLICATE_VISIT');
    const batch = {
      id: `BATCH-${String(this.sequence++).padStart(4, '0')}`,
      name: name.trim(), fund: 'UCS', claimType: 'OPD', status: 'draft',
      visitIds: selected.map(item => item.vn), itemCount: selected.length,
      claimedAmount: round(selected.reduce((sum, item) => sum + item.amount, 0)), createdAt: this.clock(), submittedAt: null
    };
    this.batches.push(batch); this.log('CREATE_BATCH', batch.id, `สร้างรอบส่ง ${batch.name}`);
    return batch;
  }

  listBatches() { return [...this.batches].reverse(); }

  submitBatch(id) {
    const batch = this.requireBatch(id);
    if (batch.status !== 'draft') throw this.error('ส่งได้เฉพาะรอบที่เป็นฉบับร่าง', 'INVALID_BATCH_STATUS');
    batch.status = 'submitted'; batch.submittedAt = this.clock();
    this.log('SUBMIT_BATCH', id, `ส่งรอบเคลม ${batch.name} ไป FDH (จำลอง)`);
    return batch;
  }

  importResponse(batchId, result = 'accepted') {
    const batch = this.requireBatch(batchId);
    if (batch.status !== 'submitted') throw this.error('ต้องส่งรอบเคลมก่อนนำเข้าผลตอบกลับ', 'BATCH_NOT_SUBMITTED');
    if (this.responses.some(item => item.batchId === batchId)) throw this.error('รอบส่งนี้นำเข้าผลแล้ว', 'RESPONSE_EXISTS');
    const rejected = result === 'rejected';
    const response = {
      id: `RESP-${String(this.sequence++).padStart(4, '0')}`, batchId, status: rejected ? 'rejected' : 'accepted',
      responseCode: rejected ? 'DENY-001' : 'A', responseMessage: rejected ? 'เอกสารประกอบไม่ครบถ้วน (ข้อมูลจำลอง)' : 'อนุมัติการเบิกจ่าย',
      claimedAmount: batch.claimedAmount, approvedAmount: rejected ? 0 : round(batch.claimedAmount * 0.95), importedAt: this.clock()
    };
    batch.status = response.status; this.responses.push(response);
    this.log('IMPORT_RESPONSE', response.id, `นำเข้าผล ${response.status} ของ ${batch.id}`);
    return response;
  }

  listResponses() { return [...this.responses].reverse(); }

  appealResponse(id) {
    const response = this.responses.find(item => item.id === id);
    if (!response) throw this.error('ไม่พบผลตอบกลับ', 'RESPONSE_NOT_FOUND');
    if (response.status !== 'rejected') throw this.error('อุทธรณ์ได้เฉพาะรายการถูกปฏิเสธ', 'NOT_REJECTED');
    response.status = 'appealed'; response.appealedAt = this.clock();
    const batch = this.requireBatch(response.batchId); batch.status = 'appealed';
    this.log('APPEAL_RESPONSE', id, `ยื่นอุทธรณ์ผลของ ${response.batchId} (จำลอง)`);
    return response;
  }

  recordPayment({ responseId, paidAmount, reference }) {
    const response = this.responses.find(item => item.id === responseId);
    if (!response) throw this.error('ไม่พบผลตอบกลับ', 'RESPONSE_NOT_FOUND');
    if (response.status !== 'accepted') throw this.error('บันทึกรับเงินได้เฉพาะรายการที่อนุมัติ', 'NOT_ACCEPTED');
    if (this.payments.some(item => item.responseId === responseId)) throw this.error('รายการนี้กระทบยอดแล้ว', 'PAYMENT_EXISTS');
    const amount = Number(paidAmount);
    if (!Number.isFinite(amount) || amount < 0) throw this.error('ยอดรับชำระไม่ถูกต้อง', 'INVALID_AMOUNT');
    const payment = {
      id: `PAY-${String(this.sequence++).padStart(4, '0')}`, responseId, batchId: response.batchId,
      approvedAmount: response.approvedAmount, paidAmount: round(amount), difference: round(amount - response.approvedAmount),
      reference: String(reference ?? '').trim() || 'DEMO-PAYMENT', receivedAt: this.clock()
    };
    this.payments.push(payment); this.requireBatch(response.batchId).status = 'paid';
    this.log('RECONCILE_PAYMENT', payment.id, `กระทบยอด ${response.batchId}`);
    return payment;
  }

  reconciliation() {
    return this.responses.filter(item => item.status === 'accepted').map(response => {
      const batch = this.requireBatch(response.batchId);
      const payment = this.payments.find(item => item.responseId === response.id);
      return { batchId: batch.id, batchName: batch.name, responseId: response.id, claimedAmount: response.claimedAmount,
        approvedAmount: response.approvedAmount, paidAmount: payment?.paidAmount ?? 0,
        difference: payment ? payment.difference : round(-response.approvedAmount), status: payment ? 'reconciled' : 'pending', reference: payment?.reference ?? null };
    });
  }

  async report(range = {}) {
    const validation = await this.validationService.validateUcs(range);
    return {
      generatedAt: this.clock(), range, validation: validation.summary,
      batches: this.batches.length, submitted: this.batches.filter(item => item.status !== 'draft').length,
      accepted: this.responses.filter(item => ['accepted'].includes(item.status)).length,
      rejected: this.responses.filter(item => ['rejected', 'appealed'].includes(item.status)).length,
      reconciliation: this.reconciliation(), cases: validation.cases
    };
  }

  log(action, entityId, message) { this.audit.push({ action, entityId, message, actor: 'เจ้าหน้าที่การเงิน', at: this.clock() }); }
  requireBatch(id) { const batch = this.batches.find(item => item.id === id); if (!batch) throw this.error('ไม่พบรอบส่งเคลม', 'BATCH_NOT_FOUND'); return batch; }
  error(message, code) { const error = new Error(message); error.code = code; error.status = 400; return error; }
}
