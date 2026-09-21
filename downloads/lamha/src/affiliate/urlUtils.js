/**
 * أدوات مشتركة لتنظيف وتحليل روابط المنتجات قبل تمريرها لمحوّلات كل متجر.
 */

// باراميترات تتبّع شائعة (يوتم، فيسبوك، جوجل، تيك توك...) بنشيلها من أي رابط
// عشان الرابط النهائي يبقى نضيف ومفيهوش تتبع لجهة تانية غير بتاعتنا.
const TRACKING_PARAMS = [
  /^utm_/i, /^fbclid$/i, /^gclid$/i, /^gclsrc$/i, /^ttclid$/i, /^msclkid$/i,
  /^mc_/i, /^ref_?$/i, /^ref_src$/i, /^spm$/i, /^scm$/i, /^algo_/i,
  /^pd_rd_/i, /^pf_rd_/i, /^_encoding$/i, /^psc$/i
];

export function safeParseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function stripTrackingParams(url) {
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some(rx => rx.test(key))) url.searchParams.delete(key);
  }
  return url;
}

export function hostIncludes(url, fragment) {
  return url.hostname.toLowerCase().includes(fragment);
}

/** يبني نتيجة موحّدة يرجّعها أي محوّل متجر */
export function buildResult({ store, canonicalUrl, affiliateUrl, appDeepLink, productId, notes }) {
  return {
    store,
    productId: productId || null,
    webUrl: affiliateUrl || canonicalUrl,
    canonicalUrl,
    appDeepLink: appDeepLink || null,
    notes: notes || []
  };
}
