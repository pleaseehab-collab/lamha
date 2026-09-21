import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger.js';

/**
 * سجل تدقيق (Audit Log) دائم ومنفصل عن الـ logger العادي — مطلوب صراحة
 * في بند "الفورتفايد أدمن بانل": أي عملية حسّاسة في لوحة الأدمن لازم تتسجل
 * بشكل يمكن مراجعته لاحقاً (مين عمل ايه، إمتى، من فين، والنتيجة).
 *
 * ⚠️ زي باقي ملفات الـ JSON في المشروع: للإنتاج الحقيقي لازم ينقل لجدول
 * DB خاص بيه (append-only / write-once)، ويفضّل يتبعت كمان لنظام لوج
 * مركزي خارجي (SIEM) عشان محدش يقدر يمسح آثاره حتى لو خد وصول للسيرفر.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, '..', 'data', 'admin-audit-log.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = load();

/**
 * @param {object} params
 * @param {string} params.action - اسم العملية، مثال: 'revenue.ledger.view_all'
 * @param {object} params.actor - { id, email, role }
 * @param {string} [params.ip]
 * @param {object} [params.target] - أي كيان اتأثر بالعملية (userId مستهدف مثلاً)
 * @param {'success'|'denied'|'error'} [params.result]
 * @param {object} [params.meta] - أي تفاصيل إضافية غير حساسة
 */
export function recordAdminAction({ action, actor, ip, target = null, result = 'success', meta = {} }) {
  const entry = {
    id: uuid(),
    ts: new Date().toISOString(),
    action,
    actorId: actor?.id || null,
    actorEmail: actor?.email || null,
    actorRole: actor?.role || null,
    ip: ip || null,
    target,
    result,
    meta
  };
  db.entries.push(entry);
  save(db);
  logger.info('Admin audit', entry);
  return entry;
}

/** Middleware جاهز: بيسجّل نجاح العملية تلقائياً بعد الـ response، وفشلها لو حصل خطأ داخلي */
export function auditAdminRoute(action) {
  return function auditMiddleware(req, res, next) {
    res.on('finish', () => {
      recordAdminAction({
        action,
        actor: req.user || null,
        ip: req.ip,
        target: { path: req.originalUrl, method: req.method },
        result: res.statusCode < 400 ? 'success' : 'denied'
      });
    });
    next();
  };
}

export function listAuditLog(limit = 200) {
  return db.entries.slice(-limit).reverse();
}

export default { recordAdminAction, auditAdminRoute, listAuditLog };
