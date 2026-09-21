import { safeParseUrl, stripTrackingParams, hostIncludes, buildResult } from '../urlUtils.js';
import { env } from '../../config/env.js';

const PRODUCT_ID_PATTERNS = [
  /\/item\/(\d+)\.html/i,
  /\/i\/(\d+)\.html/i,
  /[?&]productId=(\d+)/i
];

export function isAliExpressUrl(url) {
  return hostIncludes(url, 'aliexpress.') || hostIncludes(url, 's.click.aliexpress.com');
}

export function extractProductId(url) {
  const full = url.pathname + url.search;
  for (const rx of PRODUCT_ID_PATTERNS) {
    const m = full.match(rx);
    if (m) return m[1];
  }
  return null;
}

/**
 * روابط "s.click.aliexpress.com/e/..." هي روابط أفيليت قصيرة جاهزة بالفعل — منسيبها
 * زي ما هي (بعد تنظيف أي باراميتر تتبع زيادة) لأنها مربوطة بحساب أفيليت معيّن.
 */
function isAlreadyShortAffiliateLink(url) {
  return hostIncludes(url, 's.click.aliexpress.com');
}

export function convertAliExpress(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url || !isAliExpressUrl(url)) return null;

  stripTrackingParams(url);
  const notes = [];

  if (isAlreadyShortAffiliateLink(url)) {
    return buildResult({
      store: 'aliexpress',
      canonicalUrl: url.toString(),
      affiliateUrl: url.toString(),
      appDeepLink: `aliexpress://home?url=${encodeURIComponent(url.toString())}`,
      productId: null,
      notes: ['الرابط ده رابط أفيليت قصير جاهز أصلاً، تم فقط تنظيفه.']
    });
  }

  const productId = extractProductId(url);
  const canonicalUrl = productId
    ? `https://www.aliexpress.com/item/${productId}.html`
    : url.toString();

  const { aliexpressTrackingId, aliexpressAppKey, aliexpressAppSecret } = env.affiliate;

  let affiliateUrl = canonicalUrl;
  if (aliexpressTrackingId) {
    // بدون Affiliate API (AppKey/Secret) بيتم استخدام رابط الموقع العادي + trackingId
    // كـ query param (يعمل كـ deep-link tracking بسيط، لكنه مش بديل كامل عن
    // generatePromotionLink الرسمي اللي بيرجع رابط s.click.aliexpress.com مختصر).
    affiliateUrl = `${canonicalUrl}?aff_trace_key=${encodeURIComponent(aliexpressTrackingId)}`;
  } else {
    notes.push('ALIEXPRESS_AFF_TRACKING_ID غير مضبوط — الرابط مش هيحسب عمولة.');
  }

  if (!aliexpressAppKey || !aliexpressAppSecret) {
    notes.push(
      'لتوليد رابط أفيليت مختصر رسمي (s.click.aliexpress.com) لازم تفعيل AliExpress Affiliate API ' +
      '(open.aliexpress.com) وربط generatePromotionLink() — دالة generateShortLinkViaApi أدناه جاهزة للربط.'
    );
  }

  return buildResult({
    store: 'aliexpress',
    canonicalUrl,
    affiliateUrl,
    appDeepLink: productId ? `aliexpress://item/${productId}` : null,
    productId,
    notes
  });
}

/**
 * نقطة تكامل جاهزة مع AliExpress Affiliate API الرسمي.
 * لسه مش مفعّلة (NOT_CONFIGURED) لحد ما تتحط بيانات الاعتماد الحقيقية في .env.
 * التوقيع (signature) بتاع الـ API بيحتاج HMAC-SHA256 حسب توثيق open.aliexpress.com.
 */
export async function generateShortLinkViaApi(_canonicalUrl) {
  const { aliexpressAppKey, aliexpressAppSecret } = env.affiliate;
  if (!aliexpressAppKey || !aliexpressAppSecret) {
    throw new Error('NOT_CONFIGURED');
  }
  // TODO: نفّذ استدعاء aliexpress.affiliate.link.generate هنا حسب التوثيق الرسمي،
  // بما في ذلك بناء التوقيع، وأرجع الرابط القصير الناتج.
  throw new Error('NOT_IMPLEMENTED');
}
