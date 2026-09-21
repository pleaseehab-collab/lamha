import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'طلبات كتير، حاول لاحقاً.' }
});

/**
 * GET /api/ads/contact — زر "أعلن معنا".
 * تحويل (302) من السيرفر لمحادثة واتساب. الرقم موجود في .env بس (ADS_WHATSAPP_NUMBER)
 * ومش بيتكتب في أي HTML/JS/JSON بيوصل للزائر ولا بيتسجل في اللوج.
 * ⚠️ ملاحظة: بمجرد ما الزائر يفتح واتساب، التطبيق نفسه هيعرض الرقم — ده جوهر
 * واتساب ومفيش طريقة تخفيه عن اللي بيبدأ محادثة. لو عايز رقم منفصل عن رقمك
 * الشخصي استخدم رقم WhatsApp Business مخصص للإعلانات.
 */
export function contactHandler(req, res) {
  const number = env.contact.adsWhatsapp;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!/^\d{8,15}$/.test(number)) {
    return res.status(503).json({ error: 'قناة الإعلانات غير متاحة حالياً.' });
  }
  const text = encodeURIComponent('مرحباً، أرغب في الإعلان على لمحة.');
  res.redirect(302, `https://wa.me/${number}?text=${text}`);
}

router.get('/ads/contact', limiter, contactHandler);

export default router;
