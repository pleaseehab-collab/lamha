import { Router } from 'express';
import { requireAuth } from '../security/auth.js';
import { requireRole } from '../security/rbac.js';
import * as engine from '../auctions/reverseAuctionEngine.js';

const router = Router();

router.get('/auctions', (req, res) => {
  res.json({ auctions: engine.listActive() });
});

router.get('/auctions/:id', (req, res) => {
  const state = engine.getPublicState(req.params.id);
  if (!state) return res.status(404).json({ error: 'مزاد غير موجود.' });
  res.json({ auction: state });
});

/** أدمن/تاجر بس — إنشاء مزاد جديد */
router.post('/auctions', requireAuth, requireRole('admin', 'merchant'), (req, res) => {
  try {
    const auction = engine.createAuction(req.body || {});
    res.status(201).json({ auction: engine.getPublicState(auction.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
