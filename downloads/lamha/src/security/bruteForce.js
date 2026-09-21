import { logger } from '../utils/logger.js';

/**
 * حماية من هجمات Brute-Force على تسجيل الدخول — Phase 1 (In-Memory).
 * ⚠️ زي antiFraud.js بالظبط: الحالة في الذاكرة، للإنتاج على أكتر من سيرفر
 * لازم تتنقل لـ Redis (INCR + EXPIRE) عشان تبقى متزامنة بين كل النسخ.
 */

const attempts = new Map(); // key(ip|email) -> { count, firstAt, lockedUntil }

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000; // 15 دقيقة
const LOCK_MS = 15 * 60_000; // قفل 15 دقيقة بعد تجاوز المحاولات

function keyFor(ip, email) {
  return `${ip}|${(email || '').toLowerCase()}`;
}

export function checkLock(ip, email) {
  const k = keyFor(ip, email);
  const rec = attempts.get(k);
  if (!rec) return { locked: false };
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { locked: true, remainingMs: rec.lockedUntil - Date.now() };
  }
  return { locked: false };
}

export function recordFailure(ip, email) {
  const k = keyFor(ip, email);
  const now = Date.now();
  let rec = attempts.get(k);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    rec = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCK_MS;
    logger.warn('قفل مؤقت بسبب محاولات دخول فاشلة متكررة', { key: k.split('|')[1] });
  }
  attempts.set(k, rec);
  return rec;
}

export function recordSuccess(ip, email) {
  attempts.delete(keyFor(ip, email));
}

/** Middleware يُستخدم قبل منطق تسجيل الدخول */
export function bruteForceGuard(req, res, next) {
  const email = req.body?.email;
  const lock = checkLock(req.ip, email);
  if (lock.locked) {
    const minutes = Math.ceil(lock.remainingMs / 60000);
    return res.status(429).json({ error: `محاولات دخول كتير فشلت. حاول تاني بعد ${minutes} دقيقة.` });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, rec] of attempts.entries()) {
    if ((!rec.lockedUntil || now > rec.lockedUntil) && now - rec.firstAt > WINDOW_MS) {
      attempts.delete(k);
    }
  }
}, 5 * 60_000).unref();

export default { checkLock, recordFailure, recordSuccess, bruteForceGuard };
