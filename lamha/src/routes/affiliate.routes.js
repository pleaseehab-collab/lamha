import { Router } from 'express';
import { convertAffiliateLink } from '../affiliate/affiliateEngine.js';
import { affiliateConvertLimiter, clickLimiter } from '../security/rateLimiter.js';
import { antiFraudGuard } from '../security/antiFraud.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * POST /api/affiliate/convert
 * body: { url: string }
 * يرجّع رابط الأفيليت + الديب لينك بعد التنظيف والتحويل التلقائي.
 * (ده اللي يستخدمه التطبيق أو لوحة إدارة العروض عشان يجهّز روابط deals.json)
 */
router.post('/affiliate/convert', affiliateConvertLimiter, (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'لازم تبعت url في الـ body.' });
  }
  const result = convertAffiliateLink(url);
  if (!result) return res.status(400).json({ error: 'الرابط غير صالح.' });
  res.json(result);
});

/**
 * POST /api/affiliate/convert-batch
 * body: { urls: string[] }
 */
router.post('/affiliate/convert-batch', affiliateConvertLimiter, (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'لازم تبعت urls كمصفوفة.' });
  }
  if (urls.length > 50) {
    return res.status(400).json({ error: 'أقصى حد 50 رابط في المرة الواحدة.' });
  }
  const results = urls.map(u => ({ input: u, result: convertAffiliateLink(u) }));
  res.json({ results });
});

/**
 * GET /go?url=<encoded affiliate url>&pid=<product id>
 * نقطة إعادة توجيه موحّدة لكل نقرات الأفيليت جوه التطبيق/الموقع — بتعدي على
 * فحص مكافحة الاحتيال أولاً، وده بيسمح لينا نتتبع النقرات ونحمي حساب
 * الأفيليت من النشاط المشبوه (بوتات، نقر تلقائي...) قبل ما نوجّه المستخدم فعلياً.
 */
router.get('/go', clickLimiter, antiFraudGuard, (req, res) => {
  const target = req.query.url;
  const productId = req.query.pid || null;

  if (!target || typeof target !== 'string') {
    return res.status(400).send('رابط غير صالح.');
  }

  const converted = convertAffiliateLink(target);
  if (!converted) return res.status(400).send('رابط غير صالح.');

  logger.info('نقرة أفيليت', {
    productId,
    store: converted.store,
    suspicious: req.fraud?.isSuspicious || false
  });

  // لو النقرة مشبوهة جداً (بوت واضح)، بنوجّه لرابط المنتج العادي (canonicalUrl)
  // من غير تاج الأفيليت — كده منحميش حساب الأفيليت من نقرات وهمية بتتحسب
  // عليه كأداء ضعيف، لكن برضه منمنعش المستخدم (ممكن يكون إنسان بيستخدم أداة).
  const destination = req.fraud?.isSuspicious ? converted.canonicalUrl : converted.webUrl;

  res.redirect(302, destination);
});

export default router;
