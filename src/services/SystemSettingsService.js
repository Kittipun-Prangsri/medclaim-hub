import mysql from 'mysql2/promise';

export class SystemSettingsService {
  constructor({ clock = () => new Date().toISOString() } = {}) {
    this.clock = clock;
    this.startedAt = this.clock();
    this.settings = {
      hospital: { name: 'โรงพยาบาลตัวอย่าง', code: '12345', province: 'กรุงเทพมหานคร', timezone: 'Asia/Bangkok' },
      database: {
        type: 'mysql', host: process.env.HOSXP_DB_HOST ?? '', port: Number(process.env.HOSXP_DB_PORT ?? 3306),
        name: process.env.HOSXP_DB_NAME ?? 'hosxp_pcu', username: process.env.HOSXP_DB_USER ?? '',
        ssl: process.env.HOSXP_DB_SSL === 'true', connectionMode: 'readonly', password: process.env.HOSXP_DB_PASSWORD ?? ''
      },
      updatedAt: null
    };
  }

  getPublicSettings() {
    const { password, ...database } = this.settings.database;
    return {
      hospital: { ...this.settings.hospital },
      database: { ...database, passwordConfigured: Boolean(password) },
      system: {
        name: 'MedClaim Hub', version: '0.4.0', environment: process.env.NODE_ENV ?? 'development',
        backendStatus: 'online', nodeVersion: process.version, startedAt: this.startedAt
      },
      updatedAt: this.settings.updatedAt
    };
  }

  update(input = {}) {
    if (input.hospital) {
      const name = String(input.hospital.name ?? '').trim();
      const code = String(input.hospital.code ?? '').trim();
      if (!name || !code) throw this.error('กรุณาระบุชื่อและรหัสหน่วยบริการ', 'HOSPITAL_REQUIRED');
      this.settings.hospital = { ...this.settings.hospital, ...input.hospital, name, code };
    }
    if (input.database) {
      const port = Number(input.database.port ?? this.settings.database.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw this.error('พอร์ตฐานข้อมูลต้องอยู่ระหว่าง 1-65535', 'INVALID_PORT');
      const next = { ...this.settings.database, ...input.database, port };
      if (!Object.hasOwn(input.database, 'password') || input.database.password === '') next.password = this.settings.database.password;
      this.settings.database = next;
    }
    this.settings.updatedAt = this.clock();
    return this.getPublicSettings();
  }

  async testDatabase() {
    const db = this.settings.database;
    const missing = ['host', 'name', 'username'].filter(key => !String(db[key] ?? '').trim());
    if (!db.password) missing.push('password');
    if (missing.length) throw this.error(`ข้อมูลเชื่อมต่อยังไม่ครบ: ${missing.join(', ')}`, 'DATABASE_CONFIG_INCOMPLETE');
    let connection;
    try {
      connection = await mysql.createConnection({
        host: db.host, port: db.port, database: db.name, user: db.username, password: db.password,
        connectTimeout: 5000, ssl: db.ssl ? { rejectUnauthorized: true } : undefined
      });
      const [[server]] = await connection.query('SELECT VERSION() AS serverVersion, DATABASE() AS databaseName, CURRENT_USER() AS currentUser, @@read_only AS serverReadOnly');
      return {
        status: 'connected', message: `เชื่อมต่อ MySQL สำเร็จ (${server.serverVersion})`,
        host: db.host, port: db.port, database: server.databaseName, currentUser: server.currentUser,
        serverVersion: server.serverVersion, serverReadOnly: Boolean(server.serverReadOnly), mode: db.connectionMode, checkedAt: this.clock()
      };
    } catch (cause) {
      const messages = {
        ECONNREFUSED: 'ปลายทางปฏิเสธการเชื่อมต่อ กรุณาตรวจ IP, Port และ MySQL bind-address',
        ETIMEDOUT: 'หมดเวลารอการเชื่อมต่อ กรุณาตรวจเครือข่ายหรือ Firewall',
        ER_ACCESS_DENIED_ERROR: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือ Host นี้ไม่ได้รับอนุญาต',
        ER_BAD_DB_ERROR: 'ไม่พบชื่อฐานข้อมูลที่ระบุ',
        HANDSHAKE_SSL_ERROR: 'เชื่อมต่อ SSL/TLS ไม่สำเร็จ กรุณาตรวจ certificate หรือปิด SSL หากเซิร์ฟเวอร์ไม่รองรับ'
      };
      throw this.error(messages[cause.code] ?? `เชื่อมต่อ MySQL ไม่สำเร็จ (${cause.code ?? 'UNKNOWN'})`, 'DATABASE_CONNECTION_FAILED');
    } finally {
      await connection?.end().catch(() => {});
    }
  }

  error(message, code) { const error = new Error(message); error.code = code; error.status = 400; return error; }
}
