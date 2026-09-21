import { Router } from 'express';

const router = Router();

router.get(['/health', '/api/health'], (req, res) => {
  res.json({ ok: true }); // عن قصد: مفيش uptime/نسخة/بيئة
});

export default router;
