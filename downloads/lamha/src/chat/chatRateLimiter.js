import { env } from '../config/env.js';

const history = new Map(); // userId -> [timestamps]

/**
 * Rate limiting بسيط لرسائل الشات (منفصل عن anti-fraud بتاع نقرات الأفيليت).
 * @returns {boolean} true لو المستخدم لسه مسموح له يبعت
 */
export function allowMessage(userId) {
  const now = Date.now();
  const arr = (history.get(userId) || []).filter(t => now - t < env.chat.msgWindowMs);
  if (arr.length >= env.chat.msgLimit) {
    history.set(userId, arr);
    return false;
  }
  arr.push(now);
  history.set(userId, arr);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, arr] of history.entries()) {
    const filtered = arr.filter(t => now - t < env.chat.msgWindowMs);
    if (filtered.length === 0) history.delete(uid);
    else history.set(uid, filtered);
  }
}, 60_000).unref();

export default { allowMessage };
