import { safeParseUrl, stripTrackingParams, hostIncludes, buildResult } from '../urlUtils.js';
import { env } from '../../config/env.js';

const PRODUCT_ID_PATTERNS = [
  /-g-(\d+)\.html/i,
  /[?&]goods_id=(\d+)/i
];

export function isTemuUrl(url) {
  return hostIncludes(url, 'temu.com') || hostIncludes(url, 'temu.to');
}

export function extractProductId(url) {
  const full = url.pathname + url.search;
  for (const rx of PRODUCT_ID_PATTERNS) {
    const m = full.match(rx);
    if (m) return m[1];
  }
  return null;
}

function isShortLink(url) {
  return hostIncludes(url, 'temu.to');
}

export function convertTemu(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url || !isTemuUrl(url)) return null;

  stripTrackingParams(url);
  const notes = [];

  // temu.to/k/XXXX روابط مختصرة جاهزة من لوحة الأفيليت — منسيبها زي ما هي.
  if (isShortLink(url)) {
    return buildResult({
      store: 'temu',
      canonicalUrl: url.toString(),
      affiliateUrl: url.toString(),
      appDeepLink: `temu://web?url=${encodeURIComponent(url.toString())}`,
      productId: null,
      notes: ['الرابط ده رابط أفيليت مختصر جاهز أصلاً، تم فقط تنظيفه.']
    });
  }

  const productId = extractProductId(url);
  const canonicalUrl = url.toString();
  const { temuAffId } = env.affiliate;

  let affiliateUrl = canonicalUrl;
  if (temuAffId) {
    affiliateUrl = `${canonicalUrl}${canonicalUrl.includes('?') ? '&' : '?'}aff_id=${encodeURIComponent(temuAffId)}`;
  } else {
    notes.push('TEMU_AFF_ID غير مضبوط — الرابط مش هيحسب عمولة.');
  }

  notes.push(
    'تيمو مفيش لها API عام موحّد للأفيليت زي أمازون وعلي إكسبريس — الأفضل استخدام ' +
    'الروابط المختصرة (temu.to) اللي بتديها لوحة الأفيليت بتاعتك مباشرة بدل توليدها هنا.'
  );

  return buildResult({
    store: 'temu',
    canonicalUrl,
    affiliateUrl,
    appDeepLink: null,
    productId,
    notes
  });
}
