import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * تطبيق JWT (HS256) مبسّط بدون أي مكتبات خارجية — يعتمد فقط على node:crypto.
 * كافي لتوقيع/التحقق من tokens الدخول (access + refresh) من غير ما نضيف
 * dependency جديدة للمشروع.
 *
 * ⚠️ لازم JWT_SECRET يتحط في .env بقيمة طويلة وعشوائية حقيقية قبل الإنتاج —
 * القيمة الافتراضية هنا للتطوير فقط ومش آمنة.
 */

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlJson(obj) {
  return base64url(JSON.stringify(obj));
}

function fromBase64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payload, { expiresInSeconds = 900, secret = env.security.jwtSecret } = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const headerB64 = base64urlJson(header);
  const payloadB64 = base64urlJson(fullPayload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const signatureB64 = base64url(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function verify(token, { secret = env.security.jwtSecret } = {}) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return { valid: false, error: 'malformed_token' };
  }
  const [headerB64, payloadB64, signatureB64] = token.split('.');

  const expectedSig = base64url(
    crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
  );

  const a = Buffer.from(signatureB64);
  const b = Buffer.from(expectedSig);
  const sigOk = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!sigOk) return { valid: false, error: 'bad_signature' };

  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, error: 'bad_payload' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now >= payload.exp) {
    return { valid: false, error: 'expired' };
  }

  return { valid: true, payload };
}

export function signAccessToken(user) {
  return sign(
    { sub: user.id, role: user.role, email: user.email, type: 'access' },
    { expiresInSeconds: env.security.jwtAccessTtlSec }
  );
}

export function signRefreshToken(user) {
  return sign(
    { sub: user.id, type: 'refresh' },
    { expiresInSeconds: env.security.jwtRefreshTtlSec, secret: env.security.jwtRefreshSecret }
  );
}

export function verifyAccessToken(token) {
  return verify(token, { secret: env.security.jwtSecret });
}

export function verifyRefreshToken(token) {
  return verify(token, { secret: env.security.jwtRefreshSecret });
}

export default { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
