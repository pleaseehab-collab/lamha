import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * تقييد الوصول لراوتس الأدمن بعناوين IP محددة (ADMIN_IP_WHITELIST في .env).
 *
 * ⚠️ لازم requireAuth + requireRole('admin') يتحطوا هما كمان (دفاع متعدد
 * الطبقات) — الميدل وير ده مش بديل عنهم، هو طبقة إضافية قبلهم أو بعدهم.
 *
 * لو القائمة فاضية:
 *  - في production: بيرفض كل الطلبات (fail-closed) — عشان محدش ينسى يحددها.
 *  - في أي بيئة تانية (development/test): بيسمح بالمرور من غير قيد، عشان
 *    التطوير المحلي يفضل سهل.
 */
export function requireAdminIp(req, res, next) {
  const whitelist = env.security.adminIpWhitelist;

  if (whitelist.length === 0) {
    if (env.NODE_ENV === 'production') {
      logger.error('محاولة دخول أدمن مرفوضة: ADMIN_IP_WHITELIST غير محددة في production');
      return res.status(403).json({ error: 'الوصول للوحة الأدمن مقفول حالياً (لا توجد IPs مصرّح بها).' });
    }
    return next();
  }

  const requestIp = normalizeIp(req.ip);
  const allowed = whitelist.some(allowedIp => normalizeIp(allowedIp) === requestIp);

  if (!allowed) {
    logger.warn('محاولة دخول أدمن من IP غير مصرّح بيه', { ip: requestIp, path: req.originalUrl });
    return res.status(403).json({ error: 'العنوان ده مش مسموح له بالوصول للوحة الأدمن.' });
  }

  next();
}

// بيشيل بادئة IPv4-mapped-IPv6 (::ffff:1.2.3.4) عشان المقارنة تبقى صحيحة
// سواء التطبيق شغّال ورا proxy بيدّي IPv4 أو IPv6.
function normalizeIp(ip) {
  if (typeof ip !== 'string') return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export default { requireAdminIp };
