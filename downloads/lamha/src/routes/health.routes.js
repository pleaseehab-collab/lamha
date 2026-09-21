import { Router } from 'express';

const router = Router();

router.get(['/health', '/api/health'], (req, res) => {
  res.json({ ok: true, uptimeSec: Math.round(process.uptime()), ts: new Date().toISOString() });
});

export default router;
