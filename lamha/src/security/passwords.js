import crypto from 'node:crypto';

/**
 * تجزئة كلمات السر بـ scrypt (مدمجة في node:crypto — مفيش حاجة تتزرع).
 * الصيغة المخزّنة: "<saltHex>:<hashHex>"
 */

const KEY_LEN = 64;

export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, KEY_LEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(plain, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const candidate = crypto.scryptSync(plain, salt, KEY_LEN);
  const expected = Buffer.from(hashHex, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function isStrongEnough(plain) {
  // حد أدنى معقول: 8 أحرف على الأقل، فيه رقم وحرف. عدّلها حسب سياستك.
  return typeof plain === 'string' && plain.length >= 8 && /[0-9]/.test(plain) && /[a-zA-Z]/.test(plain);
}

export default { hashPassword, verifyPassword, isStrongEnough };
