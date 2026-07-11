import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemSettingsService } from '../src/services/SystemSettingsService.js';

test('updates hospital identity and exposes system status', () => {
  const service = new SystemSettingsService({ clock: () => '2026-07-11T10:00:00.000Z' });
  const result = service.update({ hospital: { name: 'โรงพยาบาลชุมชน', code: '10999', province: 'เชียงใหม่' } });
  assert.equal(result.hospital.name, 'โรงพยาบาลชุมชน');
  assert.equal(result.system.backendStatus, 'online');
  assert.equal(result.system.version, '0.4.0');
});

test('database password is never returned and can be preserved', () => {
  const service = new SystemSettingsService();
  const first = service.update({ database: { host: '127.0.0.1', port: 3306, name: 'hosxp_pcu', username: 'readonly', password: 'secret' } });
  assert.equal(first.database.password, undefined);
  assert.equal(first.database.passwordConfigured, true);
  service.update({ database: { host: '10.0.0.5', port: 3306, name: 'hosxp_pcu', username: 'readonly', password: '' } });
  assert.equal(service.getPublicSettings().database.passwordConfigured, true);
});

test('incomplete database configuration fails connection test', async () => {
  const service = new SystemSettingsService();
  await assert.rejects(() => service.testDatabase(), error => error.code === 'DATABASE_CONFIG_INCOMPLETE');
});
