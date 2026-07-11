import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from '../src/services/AuthService.js';

test('Provider ID mock creates an authenticated session', () => {
  const auth = new AuthService({ clock: () => 1000 });
  const session = auth.loginMock('claim_officer');
  const user = auth.authenticate(session.token);
  assert.equal(user.providerId, 'MOCK-PROVIDER-001');
  assert.equal(user.organizationCode, '12345');
  assert.equal(user.role, 'claim_officer');
});

test('RBAC allows assigned permission and denies privileged action', () => {
  const auth = new AuthService();
  const user = auth.loginMock('claim_officer').user;
  assert.equal(auth.authorize(user, 'batches:create'), user);
  assert.throws(() => auth.authorize(user, 'settings:manage'), error => error.code === 'FORBIDDEN' && error.status === 403);
});

test('admin wildcard grants all permissions and logout revokes session', () => {
  const auth = new AuthService();
  const session = auth.loginMock('admin');
  assert.equal(auth.authorize(session.user, 'settings:manage'), session.user);
  auth.logout(session.token);
  assert.throws(() => auth.authenticate(session.token), error => error.code === 'UNAUTHENTICATED');
});

test('expired session is rejected', () => {
  let now = 1000; const auth = new AuthService({ clock: () => now, sessionTtlMs: 10 });
  const session = auth.loginMock('auditor'); now = 1011;
  assert.throws(() => auth.authenticate(session.token), error => error.code === 'UNAUTHENTICATED');
});
