import { Router } from 'express';
import { buildDealReply } from '../chat/dealAssistant.js';

const router = Router();

/**
 * POST /api/assistant  { message }  →  { reply, productIds }
 * ده الـ endpoint اللي واجهة shop.html بتتوقعه في CONFIG.ASSISTANT_ENDPOINT
 * (خليه '/api/assistant' في shop.html لتفعيله). بيستخدم نفس مساعد العروض
 * بتاع الشات، وعليه نفس rate limit بتاع /api.
 */
router.post('/assistant', async (req, res, next) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 300) : '';
    if (!message) return res.status(400).json({ error: 'الرسالة فاضية.' });
    const result = await buildDealReply(message);
    res.json({ reply: result.text, productIds: result.products.map(p => p.id) });
  } catch (err) {
    next(err);
  }
});

export default router;
