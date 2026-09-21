import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/** حماية عامة لكل الـ API */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات كتير جداً، حاول تاني بعد شوية.' }
});

/** حماية أشد لنقطة تحويل روابط الأفيليت (استهداف محتمل من بوتات) */
export const affiliateConvertLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات تحويل روابط كتير جداً، استنى دقيقة.' }
});

/** حماية نقطة إعادة التوجيه (/go/:id) من نقرات البوتات المتكررة */
export const clickLimiter = rateLimit({
  windowMs: env.security.clickRateLimitWindowMs,
  max: env.security.clickRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'نقرات كتير في وقت قصير، حاول تاني بعد شوية.' }
});
