import mysql from 'mysql2/promise';

function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function dateRange({ from, to }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const start = from || weekAgo, end = to || today;
  if (!validDate(start) || !validDate(end) || start > end) throw Object.assign(new Error('ช่วงวันที่ไม่ถูกต้อง'), { code: 'INVALID_DATE_RANGE', status: 400 });
  if ((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 > 31) throw Object.assign(new Error('การอ่าน HOSxP จำกัดช่วงวันที่ไม่เกิน 31 วัน'), { code: 'DATE_RANGE_TOO_LARGE', status: 400 });
  return { from: start, to: end };
}

export class HosxpRepository {
  constructor(config, { pool } = {}) {
    this.sourceName = 'hosxp';
    this.databaseName = config.database;
    this.pool = pool ?? mysql.createPool({
      host: config.host, port: config.port, database: config.database, user: config.user, password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: true } : undefined, waitForConnections: true,
      connectionLimit: 4, maxIdle: 2, idleTimeout: 30000, connectTimeout: 5000,
      enableKeepAlive: true, keepAliveInitialDelay: 0, dateStrings: true
    });
  }

  async findUcsVisits(input = {}) {
    const range = dateRange(input);
    const page = Math.max(1, Number.parseInt(input.page ?? 1, 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number.parseInt(input.pageSize ?? 1000, 10) || 1000));
    const offset = (page - 1) * pageSize;
    const search = String(input.q ?? '').trim().slice(0, 50);
    const searchSql = search ? ' AND (o.vn = ? OR o.hn = ? OR p.cid = ? OR p.fname LIKE ? OR p.lname LIKE ?)' : '';
    const searchParams = search ? [search, search, search, `%${search}%`, `%${search}%`] : [];
    const sql = `
      SELECT o.vn, o.hn, DATE_FORMAT(o.vstdate, '%Y-%m-%d') AS serviceDate,
        COALESCE(p.cid, '') AS citizenId,
        TRIM(CONCAT_WS(' ', NULLIF(p.pname, ''), NULLIF(p.fname, ''), NULLIF(p.lname, ''))) AS patientName,
        COALESCE(o.pttype, '') AS pttype,
        COALESCE(dx.mainDiagnosis, '') AS mainDiagnosis,
        COALESCE(NULLIF(ah.CLAIM_CODE, ''), NULLIF(aha.CLAIM_CODE, ''), NULLIF(ta.claimCode, ''), '') AS authCode,
        COALESCE(charges.amount, 0) AS amount
      FROM ovst o
      INNER JOIN patient p ON p.hn = o.hn
      LEFT JOIN (
        SELECT vn, COALESCE(MAX(CASE WHEN diagtype = '1' THEN icd10 END), MIN(icd10)) AS mainDiagnosis
        FROM ovstdiag GROUP BY vn
      ) dx ON dx.vn = o.vn
      LEFT JOIN (
        SELECT vn, ROUND(SUM(COALESCE(sum_price, 0)), 2) AS amount
        FROM opitemrece GROUP BY vn
      ) charges ON charges.vn = o.vn
      LEFT JOIN (SELECT vn, MAX(CLAIM_CODE) AS CLAIM_CODE FROM authenhos WHERE COALESCE(CLAIM_CODE, '') <> '' GROUP BY vn) ah ON ah.vn = o.vn
      LEFT JOIN (SELECT VN, MAX(CLAIM_CODE) AS CLAIM_CODE FROM authenhosall WHERE COALESCE(CLAIM_CODE, '') <> '' GROUP BY VN) aha ON aha.VN = o.vn
      LEFT JOIN (
        SELECT cid, DATE_SUB(DATE(date_service), INTERVAL 543 YEAR) AS serviceDate, MAX(claimcode) AS claimCode
        FROM temp_authen_code
        WHERE date_service >= DATE_ADD(?, INTERVAL 543 YEAR)
          AND date_service < DATE_ADD(DATE_ADD(?, INTERVAL 1 DAY), INTERVAL 543 YEAR)
          AND COALESCE(claimcode, '') <> ''
        GROUP BY cid, DATE_SUB(DATE(date_service), INTERVAL 543 YEAR)
        HAVING COUNT(DISTINCT claimcode) = 1
      ) ta ON ta.cid = p.cid AND ta.serviceDate = o.vstdate
      WHERE o.vstdate BETWEEN ? AND ? ${searchSql}
      ORDER BY o.vstdate DESC, o.vn DESC
      LIMIT ? OFFSET ?`;
    try {
      const [[countRow], [rows]] = await Promise.all([
        this.pool.execute(`SELECT COUNT(*) AS total FROM ovst o INNER JOIN patient p ON p.hn = o.hn WHERE o.vstdate BETWEEN ? AND ? ${searchSql}`, [range.from, range.to, ...searchParams]),
        this.pool.execute(sql, [range.from, range.to, range.from, range.to, ...searchParams, pageSize, offset])
      ]);
      const result = rows.map(row => ({ ...row, amount: Number(row.amount ?? 0) }));
      result.pagination = { page, pageSize, total: Number(countRow[0]?.total ?? 0), totalPages: Math.ceil(Number(countRow[0]?.total ?? 0) / pageSize), query: search };
      return result;
    } catch (cause) {
      const schemaError = ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(cause.code);
      const error = new Error(schemaError ? `โครงสร้าง HOSxP ไม่ตรงกับ mapping มาตรฐาน: ${cause.sqlMessage}` : `อ่านข้อมูล HOSxP ไม่สำเร็จ (${cause.code ?? 'UNKNOWN'})`);
      Object.assign(error, { code: schemaError ? 'HOSXP_SCHEMA_MISMATCH' : 'HOSXP_QUERY_FAILED', status: 503 });
      throw error;
    }
  }

  async inspectSchema() {
    const [rows] = await this.pool.execute(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('patient','ovst','ovstdiag','opitemrece') ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [this.databaseName]
    );
    return rows;
  }

  async findVisitDetail(vn) {
    const visitNumber = String(vn ?? '').trim();
    if (!/^[A-Za-z0-9_-]{1,30}$/.test(visitNumber)) throw Object.assign(new Error('รูปแบบ VN ไม่ถูกต้อง'), { code: 'INVALID_VN', status: 400 });
    try {
      const [[visits], [diagnoses], [charges]] = await Promise.all([
        this.pool.execute(`SELECT o.vn,o.hn,DATE_FORMAT(o.vstdate,'%Y-%m-%d') serviceDate,o.pttype,
          COALESCE(p.cid,'') citizenId,TRIM(CONCAT_WS(' ',NULLIF(p.pname,''),NULLIF(p.fname,''),NULLIF(p.lname,''))) patientName
          FROM ovst o INNER JOIN patient p ON p.hn=o.hn WHERE o.vn=? LIMIT 1`, [visitNumber]),
        this.pool.execute('SELECT icd10,diagtype FROM ovstdiag WHERE vn=? ORDER BY diagtype,icd10', [visitNumber]),
        this.pool.execute('SELECT icode,qty,unitprice,sum_price FROM opitemrece WHERE vn=? ORDER BY icode LIMIT 500', [visitNumber])
      ]);
      if (!visits[0]) throw Object.assign(new Error('ไม่พบ VN ที่ระบุ'), { code: 'VISIT_NOT_FOUND', status: 404 });
      const visit = visits[0];
      const authRows = await this.pool.execute(`SELECT MAX(claimcode) authCode,COUNT(DISTINCT claimcode) codeCount
        FROM temp_authen_code WHERE cid=? AND DATE_SUB(DATE(date_service),INTERVAL 543 YEAR)=?
        AND COALESCE(claimcode,'')<>''`, [visit.citizenId, visit.serviceDate]);
      const auth = authRows[0][0] ?? {};
      return { ...visit, authCode: Number(auth.codeCount) === 1 ? auth.authCode : '', authAmbiguous: Number(auth.codeCount) > 1,
        diagnoses, charges: charges.map(item => ({ ...item, qty: Number(item.qty ?? 0), unitprice: Number(item.unitprice ?? 0), sum_price: Number(item.sum_price ?? 0) })) };
    } catch (cause) {
      if (cause.status) throw cause;
      throw Object.assign(new Error(`อ่านรายละเอียด Claim ไม่สำเร็จ (${cause.code ?? 'UNKNOWN'})`), { code: 'HOSXP_DETAIL_FAILED', status: 503 });
    }
  }

  async findAuthAmbiguities(input = {}) {
    const range = dateRange(input), page = Math.max(1, Number(input.page) || 1), pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20)), offset = (page - 1) * pageSize;
    const base = `FROM ovst o INNER JOIN patient p ON p.hn=o.hn INNER JOIN temp_authen_code a ON a.cid=p.cid
      AND DATE_SUB(DATE(a.date_service),INTERVAL 543 YEAR)=o.vstdate AND COALESCE(a.claimcode,'')<>''
      WHERE o.vstdate BETWEEN ? AND ? GROUP BY o.vn,o.hn,o.vstdate,p.cid,p.pname,p.fname,p.lname HAVING COUNT(DISTINCT a.claimcode)>1`;
    const [[countRows], [rows]] = await Promise.all([
      this.pool.execute(`SELECT COUNT(*) total FROM (SELECT o.vn ${base}) x`, [range.from, range.to]),
      this.pool.execute(`SELECT o.vn,o.hn,DATE_FORMAT(o.vstdate,'%Y-%m-%d') serviceDate,RIGHT(p.cid,4) cidLast4,
        TRIM(CONCAT_WS(' ',p.pname,p.fname,p.lname)) patientName,COUNT(DISTINCT a.claimcode) candidateCount ${base} ORDER BY o.vstdate DESC LIMIT ? OFFSET ?`, [range.from, range.to, pageSize, offset])
    ]); const total=Number(countRows[0]?.total??0); return { cases: rows, pagination:{page,pageSize,total,totalPages:Math.ceil(total/pageSize)} };
  }
  async findAuthCandidates(vn) {
    const visitNumber=String(vn??'').trim(); if(!/^[A-Za-z0-9_-]{1,30}$/.test(visitNumber)) throw Object.assign(new Error('รูปแบบ VN ไม่ถูกต้อง'),{code:'INVALID_VN',status:400});
    const [[visits]] = await Promise.all([this.pool.execute(`SELECT o.vn,o.hn,DATE_FORMAT(o.vstdate,'%Y-%m-%d') serviceDate,p.cid FROM ovst o INNER JOIN patient p ON p.hn=o.hn WHERE o.vn=? LIMIT 1`,[visitNumber])]);
    if(!visits[0]) throw Object.assign(new Error('ไม่พบ VN'),{code:'VISIT_NOT_FOUND',status:404}); const v=visits[0];
    const [rows]=await this.pool.execute(`SELECT DISTINCT claimcode FROM temp_authen_code WHERE cid=? AND DATE_SUB(DATE(date_service),INTERVAL 543 YEAR)=? AND COALESCE(claimcode,'')<>'' ORDER BY claimcode LIMIT 20`,[v.cid,v.serviceDate]);
    return {vn:v.vn,hnMasked:`•••${String(v.hn).slice(-4)}`,serviceDate:v.serviceDate,candidates:rows.map(row=>row.claimcode)};
  }

  async close() { await this.pool.end(); }
}
