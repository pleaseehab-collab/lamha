import { safeParseUrl } from './urlUtils.js';
import { isAmazonUrl, convertAmazon } from './stores/amazon.js';
import { isAliExpressUrl, convertAliExpress } from './stores/aliexpress.js';
import { isTemuUrl, convertTemu } from './stores/temu.js';

/**
 * يكتشف المتجر من الرابط ويحوّله لرابط أفيليت + Deep Link عن طريق المحوّل المناسب.
 * @param {string} rawUrl
 * @returns {{store:string, webUrl:string, canonicalUrl:string, appDeepLink:string|null, productId:string|null, notes:string[]} | null}
 */
export function convertAffiliateLink(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url) return null;

  if (isAmazonUrl(url)) return convertAmazon(rawUrl);
  if (isAliExpressUrl(url)) return convertAliExpress(rawUrl);
  if (isTemuUrl(url)) return convertTemu(rawUrl);

  return {
    store: 'unknown',
    webUrl: url.toString(),
    canonicalUrl: url.toString(),
    appDeepLink: null,
    productId: null,
    notes: ['الرابط مش من متجر مدعوم حالياً (Amazon / Temu / AliExpress فقط).']
  };
}

export function detectStore(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url) return null;
  if (isAmazonUrl(url)) return 'amazon';
  if (isAliExpressUrl(url)) return 'aliexpress';
  if (isTemuUrl(url)) return 'temu';
  return 'unknown';
}
