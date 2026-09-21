// روابط بتاعتنا إحنا (السيرفر نفسه) — مسموحة (زي روابط /go بتاعة الأفيليت
// اللي بيطلعها مساعد العروض الذكي). أي حاجة تانية بتبدأ بـ http(s):// أو
// www. أو دومين شائع بتتحظر عشان نمنع سبام وروابط خارجية غير مرغوبة.
const URL_PATTERN = /((https?:\/\/|www\.)[^\s]+)/gi;
const PHONE_PATTERN = /(?:\+?\d[\s\-]?){9,}/g; // أرقام موبايل/واتساب
const WHATSAPP_INVITE = /(wa\.me|chat\.whatsapp\.com|t\.me)\S*/i;

const recentMessages = new Map(); // userId -> [{text, ts}]
const REPEAT_WINDOW_MS = 30_000;
const REPEAT_THRESHOLD = 3; // نفس الرسالة 3 مرات خلال 30 ثانية = سبام

function isAllowedUrl(url, siteHost) {
  if (!siteHost) return false;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname === siteHost || u.hostname.endsWith(`.${siteHost}`);
  } catch {
    return false;
  }
}

/**
 * @param {string} userId
 * @param {string} text
 * @param {{siteHost?: string}} opts
 * @returns {{isSpam: boolean, reasons: string[]}}
 */
export function checkSpam(userId, text, opts = {}) {
  const reasons = [];

  const urls = text.match(URL_PATTERN) || [];
  const externalUrls = urls.filter(u => !isAllowedUrl(u, opts.siteHost));
  if (externalUrls.length) reasons.push('external_link');

  if (WHATSAPP_INVITE.test(text)) reasons.push('external_invite');
  if (PHONE_PATTERN.test(text)) reasons.push('phone_number');

  // تكرار نفس الرسالة
  const now = Date.now();
  const history = (recentMessages.get(userId) || []).filter(m => now - m.ts < REPEAT_WINDOW_MS);
  history.push({ text: text.trim(), ts: now });
  recentMessages.set(userId, history);
  const repeats = history.filter(m => m.text === text.trim()).length;
  if (repeats >= REPEAT_THRESHOLD) reasons.push('repeated_message');

  // كابس لوك زيادة عن اللزوم (احتمال سبام/صراخ)
  const letters = text.replace(/[^A-Za-z\u0600-\u06FF]/g, '');
  if (letters.length > 12) {
    const upper = letters.replace(/[a-z\u0600-\u06FF]/g, '');
    if (upper.length / letters.length > 0.8) reasons.push('excessive_caps');
  }

  return { isSpam: reasons.length > 0, reasons };
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, history] of recentMessages.entries()) {
    const filtered = history.filter(m => now - m.ts < REPEAT_WINDOW_MS);
    if (filtered.length === 0) recentMessages.delete(uid);
    else recentMessages.set(uid, filtered);
  }
}, 60_000).unref();

export default { checkSpam };
