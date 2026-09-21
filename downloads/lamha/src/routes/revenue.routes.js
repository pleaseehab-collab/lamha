import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { requireAuth } from '../security/auth.js';
import { requireRole } from '../security/rbac.js';
import { requireAdminIp } from '../security/ipWhitelist.js';
import { auditAdminRoute, listAuditLog } from '../security/auditLog.js';
import { splitRevenue } from '../revenue/revenueEngine.js';
import * as ledger from '../revenue/revenueLedger.js';
import * as userStore from '../users/userStore.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/revenue/wallet', requireAuth, (req, res) => {
  res.json({ wallet: userStore.getWallet(req.user.id) });
});

router.get('/revenue/ledger/me', requireAuth, (req, res) => {
  res.json({ entries: ledger.listForUser(req.user.id) });
});

/**
 * أدمن بس: كل السجل — للشفافية والمراجعة.
 * محمي بـ 3 طبقات: JWT (requireAuth) + دور admin (requireRole) + IP
 * مصرّح بيه (requireAdminIp)، وكل وصول بيتسجل في audit log دائم.
 */
router.get(
  '/revenue/ledger',
  requireAuth,
  requireRole('admin'),
  requireAdminIp,
  auditAdminRoute('revenue.ledger.view_all'),
  (req, res) => {
    res.json({ entries: ledger.listAll() });
  }
);

/** أدمن بس: عرض سجل التدقيق نفسه (مين عمل ايه في لوحة الأدمن) */
router.get(
  '/admin/audit-log',
  requireAuth,
  requireRole('admin'),
  requireAdminIp,
  auditAdminRoute('admin.audit_log.view'),
  (req, res) => {
    res.json({ entries: listAuditLog() });
  }
);

/**
 * Webhook استقبال تأكيد تحويل/عمولة من شبكة الأفيليت أو من نظام الطلبات
 * الداخلي. محمي بسر مشترك (وليس JWT مستخدم عادي) لأن اللي بينادي عليه
 * سيرفر-لسيرفر. لازم يتبعت هيدر X-Webhook-Secret يطابق REVENUE_WEBHOOK_SECRET.
 */
router.post('/affiliate/conversion-webhook', (req, res) => {
  const provided = req.header('x-webhook-secret') || '';
  const expected = env.revenue.webhookSecret;
  const ok =
    expected &&
    provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

  if (!ok) {
    logger.warn('محاولة نداء webhook بسر غلط أو غير موجود');
    return res.status(401).json({ error: 'غير مصرح.' });
  }

  const { orderId, grossCommission, sellerId, referrerId } = req.body || {};
  const result = splitRevenue({ orderId, grossCommission, sellerId, referrerId });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, duplicate: !!result.duplicate, entry: result.entry });
});

export default router;
