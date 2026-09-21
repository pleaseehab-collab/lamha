import crypto from 'node:crypto';
import { verifyPassword } from './passwords.js';

/**
 * بوابة لوحة /admin — كلمة سر + جلسة موقّعة + قفل ضد التخمين.
 *
 * - كلمة السر متخزنة كـ scrypt hash في ADMIN_PASSWORD_HASH (npm run admin:password).
 *   من غير hash مضبوط البوابة "مقفولة" بالكامل (fail-closed).
 * - الجلسة: توكن HMAC موقّع (مدة 30 دقيقة) في كوكي HttpOnly + SameSite=Strict
 *   (+ Secure في production). تسجيل الخروج بيبطل التوكن فوراً.
 * - أي طلب تعديل (POST/PUT/PATCH/DELETE) لازم يكون فيه جلسة صالحة + هيدر
 *   X-Lamha-Admin (حماية CSRF إضافية)، وأي محاولة تعديل بدون تصريح بتتحسب
 *   "strike" وبعد 3 منها الـ IP بيتحظر 15 دقيقة.
 * - 5 محاولات دخول غلط = حظر الـ IP 15 دقيقة، وكل محاولة فاشلة بتتأخر ثانية.
 *
 * ⚠️ الحظر في الذاكرة (بيتصفّر مع restart) — كافي لسيرفر واحد، ولنسخ متعددة استخدم Redis.
 */

const SESSION_TTL_SEC = 30 * 60;
const MAX_FAILS = 5;
const MAX_STRIKES = 3;
const LOCK_MS = 15 * 60 * 1000;
export const COOKIE_NAME = 'lamha_admin';
export const CSRF_HEADER = 'x-lamha-admin';

const failures = new Map(); // ip -> { fails, strikes, lockedUntil }
const revoked = new Set(); // nonces اللي اتعمل لها logout

const secret = () => `${process.env.JWT_SECRET || 'dev-only-insecure-jwt-secret-change-me'}:admin-session`;
const passwordHash = () => process.env.ADMIN_PASSWORD_HASH || '';
const isProd = () => (process.env.NODE_ENV || 'development') === 'production';

export const isConfigured = () => passwordHash().length > 0;
export function _resetForTests() { failures.clear(); revoked.clear(); }

// ---------- قفل ----------
function record(ip) {
  if (!failures.has(ip)) failures.set(ip, { fails: 0, strikes: 0, lockedUntil: 0 });
  return failures.get(ip);
}

export function lockRemainingMs(ip) {
  const r = failures.get(ip);
  if (!r) return 0;
  const left = r.lockedUntil - Date.now();
  if (left > 0) return left;
  if (r.lockedUntil) { r.fails = 0; r.strikes = 0; r.lockedUntil = 0; }
  return 0;
}

function addFail(ip, kind) {
  const r = record(ip);
  if (kind === 'strike') r.strikes += 1; else r.fails += 1;
  if (r.fails >= MAX_FAILS || r.strikes >= MAX_STRIKES) r.lockedUntil = Date.now() + LOCK_MS;
}

// ---------- جلسة ----------
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sig = payload => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function createSession() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const body = `${exp}.${nonce}`;
  return `${body}.${sig(body)}`;
}

export function verifySession(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [exp, nonce, mac] = parts;
  const expected = Buffer.from(sig(`${exp}.${nonce}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (!Number.isFinite(Number(exp)) || Number(exp) * 1000 < Date.now()) return null;
  if (revoked.has(nonce)) return null;
  return { exp: Number(exp), nonce };
}

export function revokeSession(token) {
  const s = verifySession(token);
  if (s) revoked.add(s.nonce);
}

export function sessionCookie(token, { clear = false } = {}) {
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/admin'];
  if (isProd()) flags.push('Secure');
  flags.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_TTL_SEC}`);
  return `${COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}; ${flags.join('; ')}`;
}

// ---------- تسجيل الدخول ----------
export async function attemptLogin(ip, password) {
  if (!isConfigured()) return { ok: false, status: 503, error: 'لوحة الأدمن غير مفعّلة (ADMIN_PASSWORD_HASH غير محدد).' };
  const left = lockRemainingMs(ip);
  if (left > 0) return { ok: false, status: 429, error: `محاولات كتير. جرّب بعد ${Math.ceil(left / 60000)} دقيقة.` };

  const good = typeof password === 'string' && password.length > 0 && password.length <= 200 && verifyPassword(password, passwordHash());
  if (!good) {
    addFail(ip, 'fail');
    await new Promise(r => setTimeout(r, process.env.NODE_ENV === 'test' ? 0 : 1000)); // بطّئ التخمين
    return { ok: false, status: 401, error: 'كلمة السر غير صحيحة.' };
  }
  failures.delete(ip);
  return { ok: true, token: createSession() };
}

// ---------- ميدل وير ----------
const wantsHtml = req => req.method === 'GET' && String(req.headers?.accept || '').includes('text/html');

export function requireAdminSession(req, res, next) {
  const ip = req.ip || 'unknown';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (!isConfigured()) return res.status(503).json({ error: 'لوحة الأدمن غير مفعّلة.' });
  if (lockRemainingMs(ip) > 0) return res.status(429).json({ error: 'الوصول محظور مؤقتاً.' });

  const session = verifySession(parseCookies(req.headers?.cookie || '')[COOKIE_NAME]);
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

  if (!session) {
    if (mutating) addFail(ip, 'strike'); // محاولة تعديل بدون تصريح
    if (wantsHtml(req)) return res.redirect(302, '/admin/login');
    return res.status(401).json({ error: 'غير مصرح.' });
  }
  if (mutating && req.headers?.[CSRF_HEADER] !== '1') {
    addFail(ip, 'strike');
    return res.status(403).json({ error: 'طلب مرفوض.' });
  }
  req.adminSession = session;
  next();
}

export default { requireAdminSession, attemptLogin, createSession, verifySession, revokeSession, sessionCookie, parseCookies, isConfigured };
