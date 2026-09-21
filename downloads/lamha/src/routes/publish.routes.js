import { Router } from 'express';
import { requireAuth } from '../security/auth.js';
import { requireRole } from '../security/rbac.js';
import { requireAdminIp } from '../security/ipWhitelist.js';
import { recordAdminAction } from '../security/auditLog.js';
import { publishDeal } from '../publishing/publishEngine.js';
import * as userStore from '../users/userStore.js';
import { PACKAGES } from '../merchants/merchantPackages.js';

const router = Router();

router.get('/merchants/packages', (req, res) => {
  res.json({ packages: Object.values(PACKAGES) });
});

/** أدمن بس — تفعيل باقة لتاجر (ربط دفع خارجي حقيقي مطلوب قبل النداء ده) */
router.post(
  '/merchants/:userId/subscribe',
  requireAuth,
  requireRole('admin'),
  requireAdminIp,
  (req, res) => {
    const { packageId } = req.body || {};
    if (!PACKAGES[packageId]) return res.status(400).json({ error: 'باقة غير معروفة.' });
    const merchant = userStore.setMerchantPackage(req.params.userId, packageId);
    if (!merchant) return res.status(404).json({ error: 'مستخدم غير موجود.' });
    recordAdminAction({
      action: 'merchants.subscribe',
      actor: req.user,
      ip: req.ip,
      target: { userId: req.params.userId, packageId }
    });
    res.json({ merchant });
  }
);

router.post('/merchants/publish', requireAuth, requireRole('merchant', 'admin'), async (req, res) => {
  const { deal, platforms } = req.body || {};
  if (!deal || !deal.title) return res.status(400).json({ error: 'بيانات العرض (deal) مطلوبة.' });

  const result = await publishDeal(deal, { merchantId: req.user.id, platforms });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

export default router;
