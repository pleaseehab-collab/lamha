import { detectStore, convertAffiliateLink } from '../affiliate/affiliateEngine.js';
import { readFileSync } from 'node:fs';

// readFileSync بدل `import ... with {type:'json'}` عشان يشتغل على كل نسخ Node >= 18.17
const dealsData = JSON.parse(readFileSync(new URL('../data/deals.json', import.meta.url), 'utf8'));

/**
 * روبوت مقارنة الأسعار — Phase 1.
 * حالياً بيقارن بين العروض المخزّنة في data/deals.json (نفس مصدر بيانات
 * الموقع الأساسي) لنفس المنتج عبر أكتر من متجر، وبيرجّع روابط الأفيليت
 * الجاهزة لكل نتيجة.
 *
 * ⚠️ مقارنة أسعار حقيقية على مستوى المتاجر (Amazon/AliExpress/Temu
 * API بحث فعلي) محتاجة اشتراكات/مفاتيح API رسمية لكل متجر (زي
 * Amazon Product Advertising API، AliExpress Open Platform API) —
 * مش متاحة هنا، فالدالة searchExternal() تحت عبارة عن نقطة توسيع
 * (extension point) جاهزة تتوصل بيها لما تجهّز مفاتيح الـ API دي.
 */

export function compareLocal(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const matches = (dealsData.products || dealsData.deals || []).filter(d =>
    (d.title || '').toLowerCase().includes(q)
  );

  return matches
    .map(d => {
      const converted = d.url ? convertAffiliateLink(d.url) : null;
      return {
        id: d.id,
        title: d.title,
        price: d.price,
        currency: d.currency || 'EGP',
        store: converted?.store || d.store || detectStore(d.url || '') || 'unknown',
        link: converted?.affiliateUrl || d.url
      };
    })
    .sort((a, b) => (Number(a.price) || Infinity) - (Number(b.price) || Infinity));
}

/** نقطة توسيع — هتتفعّل لما تتوفر مفاتيح API رسمية للمتاجر */
export async function searchExternal(_query) {
  return { ok: false, reason: 'not_configured', note: 'محتاج مفاتيح API رسمية من كل متجر.' };
}

export default { compareLocal, searchExternal };
