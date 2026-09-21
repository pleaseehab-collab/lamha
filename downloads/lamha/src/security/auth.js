import { verifyAccessToken } from './jwt.js';
import { findById } from '../users/userStore.js';

/**
 * Middleware مصادقة حقيقية بالـ JWT — بيحل محل الـ header المؤقت
 * (x-user-id) اللي كان مستخدم كـ placeholder في games.routes.js.
 * لازم العميل يبعت: Authorization: Bearer <accessToken>
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'محتاج تسجيل دخول (Authorization: Bearer <token>).' });

  const { valid, payload, error } = verifyAccessToken(token);
  if (!valid) return res.status(401).json({ error: `توكن غير صالح (${error}).` });

  const user = findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'المستخدم غير موجود.' });

  req.user = { id: user.id, role: user.role, email: user.email };
  next();
}

/** زي requireAuth بس متسامح — لو مفيش توكن، بيكمل من غير req.user */
export function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  const { valid, payload } = verifyAccessToken(token);
  if (valid) {
    const user = findById(payload.sub);
    if (user) req.user = { id: user.id, role: user.role, email: user.email };
  }
  next();
}

export default { requireAuth, optionalAuth };
