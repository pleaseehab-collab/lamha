import { safeParseUrl, stripTrackingParams, hostIncludes, buildResult } from '../urlUtils.js';
import { env } from '../../config/env.js';

// أمازون بيحط الـ ASIN في مسارات متعددة، بنجرب كل الأشكال المعروفة
const ASIN_PATTERNS = [
  /\/dp\/([A-Z0-9]{10})/i,
  /\/gp\/product\/([A-Z0-9]{10})/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
  /\/product\/([A-Z0-9]{10})/i,
  /[?&]asin=([A-Z0-9]{10})/i
];

export function isAmazonUrl(url) {
  return hostIncludes(url, 'amazon.');
}

export function extractAsin(url) {
  const full = url.pathname + url.search;
  for (const rx of ASIN_PATTERNS) {
    const m = full.match(rx);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export function convertAmazon(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url || !isAmazonUrl(url)) return null;

  stripTrackingParams(url);
  const asin = extractAsin(url);
  const notes = [];
  const tag = env.affiliate.amazonTag;

  if (!tag) notes.push('AMAZON_EG_TAG غير مضبوط في متغيرات البيئة — الرابط مش هيحسب عمولة.');

  // لو قدرنا نستخرج الـ ASIN بننضف الرابط بالكامل ونبنيه من الصفر (أقصر وأنضف)
  let canonicalUrl;
  if (asin) {
    canonicalUrl = `https://${url.hostname.replace(/^www\./, 'www.')}/dp/${asin}`;
  } else {
    // مش لاقيين ASIN (رابط بحث أو قسم مثلاً) — بنكتفي بتنظيف الباراميترات فقط
    canonicalUrl = url.toString();
    notes.push('لم يتم العثور على ASIN داخل الرابط، تم فقط تنظيف باراميترات التتبع.');
  }

  const affiliateUrl = tag
    ? `${canonicalUrl}${canonicalUrl.includes('?') ? '&' : '?'}tag=${encodeURIComponent(tag)}`
    : canonicalUrl;

  // ديب لينك لتطبيق أمازون (best-effort — الشكل الرسمي بيتغيّر بين نسخ التطبيق،
  // فالأفضل تجربته على أجهزة حقيقية وتحديثه لو لزم).
  const appDeepLink = asin
    ? `com.amazon.mobile.shopping.web://amazon.eg/dp/${asin}?tag=${encodeURIComponent(tag || '')}`
    : null;

  return buildResult({
    store: 'amazon',
    canonicalUrl,
    affiliateUrl,
    appDeepLink,
    productId: asin,
    notes
  });
}
