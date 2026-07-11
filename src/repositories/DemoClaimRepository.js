const records = [
  { vn: '6907110001', hn: '0007421', patientName: 'สมชาย ใจดี', serviceDate: '2026-07-11', citizenId: '1101700203450', pttype: '01', mainDiagnosis: 'J00', authCode: 'UCS260711001', amount: 860 },
  { vn: '6907110002', hn: '0011832', patientName: 'สุดา แสงทอง', serviceDate: '2026-07-11', citizenId: '1101700203451', pttype: '01', mainDiagnosis: '', authCode: 'UCS260711002', amount: 1240 },
  { vn: '6907110003', hn: '0020911', patientName: 'อนันต์ พูนสุข', serviceDate: '2026-07-11', citizenId: '3101700203456', pttype: '02', mainDiagnosis: 'E11.9', authCode: '', amount: 2150 },
  { vn: '6907100004', hn: '0009134', patientName: 'มาลี รุ่งเรือง', serviceDate: '2026-07-10', citizenId: '3101700203456', pttype: '09', mainDiagnosis: 'I10', authCode: 'UCS260710004', amount: 540 }
];

export class DemoClaimRepository {
  constructor() { this.sourceName = 'demo'; }
  async findUcsVisits({ from, to, q = '' }) {
    const search = String(q).trim().toLowerCase();
    const result = records.filter(item => (!from || item.serviceDate >= from) && (!to || item.serviceDate <= to) && (!search || [item.vn, item.hn, item.citizenId, item.patientName].some(value => value.toLowerCase().includes(search))));
    result.pagination = { page: 1, pageSize: result.length, total: result.length, totalPages: 1, query: search };
    return result;
  }
}
