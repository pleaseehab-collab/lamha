import { Router } from 'express';
import { requireAuth } from '../security/auth.js';
import { requireRole } from '../security/rbac.js';
import * as engine from '../groupbuy/groupBuyEngine.js';

const router = Router();

router.get('/groupbuy', (req, res) => res.json({ campaigns: engine.listActive() }));

router.get('/groupbuy/:id', (req, res) => {
  const campaign = engine.getPublicState(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'الحملة غير موجودة.' });
  res.json({ campaign });
});

router.post('/groupbuy', requireAuth, requireRole('admin', 'merchant'), (req, res) => {
  try {
    const campaign = engine.createCampaign(req.body || {});
    res.status(201).json({ campaign });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/groupbuy/:id/join', requireAuth, (req, res) => {
  const result = engine.join(req.params.id, req.user.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

export default router;
