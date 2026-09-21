import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as userStore from '../users/userStore.js';
import { hashPassword, isStrongEnough } from '../security/passwords.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../security/jwt.js';
import { bruteForceGuard, recordFailure, recordSuccess } from '../security/bruteForce.js';
import { requireAuth } from '../security/auth.js';

const router = Router();

// حماية إضافية خاصة بـ auth (فوق apiLimiter العام) — تصعيد ضد credential stuffing
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كتير، حاول تاني بعد شوية.' }
});

function tokensFor(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user)
  };
}

router.post('/auth/register', authLimiter, (req, res) => {
  const { email, password, referralCode } = req.body || {};
  if (!email || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'إيميل غير صالح.' });
  }
  if (!isStrongEnough(password)) {
    return res.status(400).json({ error: 'كلمة السر لازم تكون 8 حروف على الأقل، وفيها رقم وحرف.' });
  }
  const result = userStore.createUser({ email, password, referredByCode: referralCode || null });
  if (!result.ok) return res.status(409).json({ error: result.error });

  const tokens = tokensFor(result.user);
  res.status(201).json({ user: userStore.publicUser(result.user), ...tokens });
});

router.post('/auth/login', authLimiter, bruteForceGuard, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'الإيميل وكلمة السر مطلوبين.' });

  const result = userStore.verifyLogin(email, password);
  if (!result.ok) {
    recordFailure(req.ip, email);
    return res.status(401).json({ error: result.error });
  }
  recordSuccess(req.ip, email);
  const tokens = tokensFor(result.user);
  res.json({ user: userStore.publicUser(result.user), ...tokens });
});

router.post('/auth/refresh', authLimiter, (req, res) => {
  const { refreshToken } = req.body || {};
  const { valid, payload } = verifyRefreshToken(refreshToken || '');
  if (!valid || payload.type !== 'refresh') return res.status(401).json({ error: 'refresh token غير صالح.' });

  const user = userStore.findById(payload.sub);
  if (!user) return res.status(401).json({ error: 'مستخدم غير موجود.' });

  res.json(tokensFor(user));
});

router.get('/auth/me', requireAuth, (req, res) => {
  const user = userStore.findById(req.user.id);
  res.json({ user: userStore.publicUser(user) });
});

export default router;
