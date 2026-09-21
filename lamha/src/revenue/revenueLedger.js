import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';

/**
 * سجل عمولات append-only مبني على JSON — Phase 1.
 * ⚠️ نفس ملاحظة userStore.js: للإنتاج الحقيقي ينقل لجدول Postgres مع
 * UNIQUE constraint على orderId عشان الـ idempotency تتضمن على مستوى الداتابيز
 * نفسها مش بس على مستوى الكود.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(__dirname, '..', 'data', 'revenue-ledger.json');
const LOCK_DIR = `${LEDGER_FILE}.lock`;

function load() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(LEDGER_FILE), { recursive: true });
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(db, null, 2), 'utf8');
}

let db = load();

/**
 * قفل ملف بسيط (advisory lock) قائم على fs.mkdirSync، اللي بيضمن العملية
 * atomic على مستوى نظام الملفات: عملية واحدة بس تقدر تعمل mkdir بنجاح لو
 * المجلد مش موجود، والباقي بياخدوا EEXIST ويعيدوا المحاولة.
 *
 * ⚠️ ده حل "Phase 1" بيحل مشكلة تسابق العمليات (race condition) لو
 * السيرفر شغّال بأكتر من process على نفس السيرفر (مثلاً Node cluster/PM2)
 * وبيشاركوا نفس الـ disk. **لكنه مش كافي لو التطبيق شغّال على أكتر من
 * سيرفر فيزيائي مختلف** (كل سيرفر ليه disk خاص بيه) — في الحالة دي، ولا
 * أي نظام إنتاج حقيقي لمنصة مالية، لازم الانتقال لقاعدة بيانات حقيقية
 * (PostgreSQL) مع UNIQUE constraint على orderId جوه transaction، اللي
 * بتضمن الـ idempotency على مستوى الداتابيز نفسها بدل قفل ملفات يدوي.
 */
function acquireLock({ timeoutMs = 5000, retryDelayMs = 15 } = {}) {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(LOCK_DIR);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error('تعذّر الحصول على قفل سجل العمولات (revenue ledger) خلال الوقت المسموح.');
      }
      // انتظار مزامن قصير قبل إعادة المحاولة (مقبول هنا لأن العملية كلها
      // خفيفة وسريعة الطبيعة: قراءة JSON صغير + كتابة، مش استعلام ثقيل).
      const until = Date.now() + retryDelayMs;
      while (Date.now() < until) { /* busy-wait قصير جداً */ }
    }
  }
}

function releaseLock() {
  try { fs.rmdirSync(LOCK_DIR); } catch { /* ignored — القفل ممكن يكون اتشال قبل كده */ }
}

/**
 * ينفّذ fn جوه قفل، وبعد ما ياخد القفل بيعيد تحميل الملف من الديسك أول
 * حاجة (عشان يشوف آخر حالة كتبها أي process تاني)، وبعد ما fn يخلص
 * بيحفظ ويسيب القفل. ده اللي بيضمن إن findByOrderId + append يحصلوا
 * كـ "عملية واحدة" ذرية بدل ما يبقوا خطوتين منفصلتين ممكن يتقاطعوا مع
 * process تاني بينهم.
 */
export function withLedgerLock(fn) {
  acquireLock();
  try {
    db = load(); // إعادة التحميل من الديسك لضمان رؤية آخر تحديث من أي process تاني
    const result = fn();
    save(db);
    return result;
  } finally {
    releaseLock();
  }
}

/** Idempotency: بيدوّر بأوردر ID اتعالج قبل كده ولا لأ */
export function findByOrderId(orderId) {
  return db.entries.find(e => e.orderId === orderId) || null;
}

/** ⚠️ استخدمها فقط جوه withLedgerLock — مش بتحفظ لوحدها، عشان الحفظ يحصل مرة واحدة في نهاية القفل */
export function append(entry) {
  const record = { id: uuid(), createdAt: new Date().toISOString(), ...entry };
  db.entries.push(record);
  return record;
}

export function listForUser(userId, limit = 50) {
  return db.entries
    .filter(e => e.sellerId === userId || e.referrerId === userId)
    .slice(-limit)
    .reverse();
}

export function listAll(limit = 200) {
  return db.entries.slice(-limit).reverse();
}

export default { findByOrderId, append, listForUser, listAll, withLedgerLock };
