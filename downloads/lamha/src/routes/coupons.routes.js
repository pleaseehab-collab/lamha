import { Router } from 'express';
import { requireAuth } from '../security/auth.js';
import { requireRole } from '../security/rbac.js';
import * as marketplace from '../coupons/couponMarketplace.js';

const router = Router();

router.get('/coupons/marketplace', (req, res) => res.json({ listings: marketplace.listActive() }));

router.get('/coupons/marketplace/:id', (req, res) => {
  const listing = marketplace.getPublicListing(req.params.id);
  if (!listing) return res.status(404).json({ error: 'كوبون غير موجود.' });
  res.json({ listing });
});

router.post('/coupons/marketplace', requireAuth, requireRole('merchant', 'admin'), (req, res) => {
  try {
    const listing = marketplace.publishCoupon({ ...req.body, merchantId: req.user.id });
    res.status(201).json({ listing });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/coupons/marketplace/:id/claim', requireAuth, (req, res) => {
  const result = marketplace.claim(req.params.id, req.user.id);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

export default router;
