import { randomUUID } from 'node:crypto';

export const ROLE_PERMISSIONS = {
  claim_officer: ['dashboard:read', 'claims:read', 'batches:create'],
  reviewer: ['dashboard:read', 'claims:read', 'batches:read', 'batches:submit', 'responses:manage'],
  finance: ['dashboard:read', 'batches:read', 'responses:read', 'reconciliation:manage', 'reports:read'],
  auditor: ['dashboard:read', 'claims:read', 'batches:read', 'responses:read', 'reconciliation:read', 'reports:read'],
  admin: ['*']
};

const mockProviders = {
  claim_officer: { providerId: 'MOCK-PROVIDER-001', citizenIdMasked: '1-xxxx-xxxxx-01-1', name: 'นางสาวกานดา สมบูรณ์', position: 'นักวิชาการเงินและบัญชี', organizationCode: '12345', organizationName: 'โรงพยาบาลตัวอย่าง' },
  reviewer: { providerId: 'MOCK-PROVIDER-002', citizenIdMasked: '3-xxxx-xxxxx-02-2', name: 'นายแพทย์ธีรภัทร วัฒนะ', position: 'นายแพทย์ชำนาญการ', organizationCode: '12345', organizationName: 'โรงพยาบาลตัวอย่าง' },
  finance: { providerId: 'MOCK-PROVIDER-003', citizenIdMasked: '3-xxxx-xxxxx-03-3', name: 'นางพิมพ์ใจ การเงิน', position: 'เจ้าพนักงานการเงินและบัญชี', organizationCode: '12345', organizationName: 'โรงพยาบาลตัวอย่าง' },
  auditor: { providerId: 'MOCK-PROVIDER-004', citizenIdMasked: '1-xxxx-xxxxx-04-4', name: 'นายตรวจสอบ ภายใน', position: 'นักวิชาการตรวจสอบภายใน', organizationCode: '12345', organizationName: 'โรงพยาบาลตัวอย่าง' },
  admin: { providerId: 'MOCK-PROVIDER-005', citizenIdMasked: '1-xxxx-xxxxx-05-5', name: 'ผู้ดูแลระบบ MedClaim', position: 'นักวิชาการคอมพิวเตอร์', organizationCode: '12345', organizationName: 'โรงพยาบาลตัวอย่าง' }
};

export class AuthService {
  constructor({ clock = () => Date.now(), sessionTtlMs = 8 * 60 * 60 * 1000 } = {}) { this.clock = clock; this.sessionTtlMs = sessionTtlMs; this.sessions = new Map(); }
  loginMock(role) {
    if (!mockProviders[role]) throw this.error('ไม่พบบทบาทจำลองที่เลือก', 'INVALID_MOCK_ROLE', 400);
    const token = randomUUID();
    const session = { token, user: { ...mockProviders[role], role, permissions: ROLE_PERMISSIONS[role] }, createdAt: this.clock(), expiresAt: this.clock() + this.sessionTtlMs };
    this.sessions.set(token, session); return { token, user: session.user, expiresAt: session.expiresAt };
  }
  authenticate(token) {
    const session = token && this.sessions.get(token);
    if (!session || session.expiresAt <= this.clock()) { if (token) this.sessions.delete(token); throw this.error('กรุณาเข้าสู่ระบบด้วย Provider ID', 'UNAUTHENTICATED', 401); }
    return session.user;
  }
  authorize(user, permission) {
    if (!user.permissions.includes('*') && !user.permissions.includes(permission)) throw this.error('บัญชีนี้ไม่มีสิทธิ์ดำเนินการ', 'FORBIDDEN', 403);
    return user;
  }
  logout(token) { if (token) this.sessions.delete(token); }
  error(message, code, status) { const error = new Error(message); Object.assign(error, { code, status }); return error; }
}
