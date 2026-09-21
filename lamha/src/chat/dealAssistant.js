import { getDealsData } from '../routes/deals.routes.js';
import { env } from '../config/env.js';

export const BOT_ID = 'lamha-bot';
export const BOT_NAME = 'مساعد العروض 🤖';

// نفس منطق الكلمات المفتاحية المستخدم في واجهة shop.html، عشان لو المستخدم
// كتب "عايز سماعات" في الشات نلاقيله نفس نوع المنتجات اللي هيلاقيها بالبحث
// في الموقع.
const CATEGORY_KEYWORDS = {
  electronics: ['سماع', 'airpods', 'بلوتوث', 'سبيكر', 'شاحن', 'ساعه ذكيه', 'الكترون', 'كاميرا', 'باور'],
  phones: ['موبايل', 'هاتف', 'تليفون', 'جوال', 'سامسونج', 'ايفون', 'iphone', 'samsung'],
  home: ['منزل', 'مطبخ', 'غساله', 'ثلاجه', 'قهوه', 'اجهزه', 'ديكور'],
  fashion: ['هدوم', 'ملابس', 'لبس', 'جزمه', 'حذاء', 'شنطه', 'كوتشي'],
  beauty: ['بشره', 'سيروم', 'جمال', 'عنايه', 'مكياج', 'شعر']
};

const TRIGGER_PATTERNS = [
  /^\/(deals|عروض|عرض)\b/i,
  /عايز\s+عرض/i,
  /فيه\s+عرض/i,
  /في\s+خصم/i,
  /انصحني/i,
  /اقترح/i,
  /رخيص/i
];

function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/** هل الرسالة فعلاً موجّهة للمساعد الذكي؟ */
export function isDealQuery(text) {
  return TRIGGER_PATTERNS.some(rx => rx.test(text));
}

function detectCategory(normText) {
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => normText.includes(normalize(k)))) return cat;
  }
  return null;
}

const discount = p => (p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

function buildGoLink(product) {
  const base = env.SITE_URL.replace(/\/$/, '');
  return `${base}/api/go?pid=${encodeURIComponent(product.id)}&url=${encodeURIComponent(product.url)}`;
}

/**
 * يبني رد المساعد الذكي بناءً على رسالة المستخدم، أو null لو مفيش منتجات مطابقة.
 * @returns {Promise<{text: string, products: object[]}|null>}
 */
export async function buildDealReply(rawText) {
  const norm = normalize(rawText);
  const data = await getDealsData();
  let pool = data.products || [];

  const category = detectCategory(norm);
  if (category) pool = pool.filter(p => p.category === category);

  const wantsFlash = /فلاش|flash|سريع/i.test(norm);
  if (wantsFlash) pool = pool.filter(p => p.flash);

  const top = [...pool].sort((a, b) => discount(b) - discount(a)).slice(0, 3);

  if (top.length === 0) {
    return {
      text: 'مفيش عروض مطابقة دلوقتي 🙁 جرّب تسأل عن قسم تاني، أو قول "عايز عروض إلكترونيات" مثلاً.',
      products: []
    };
  }

  const lines = top.map(p => {
    const d = discount(p);
    const priceTxt = `${Number(p.price).toLocaleString('en-US')} ${p.currency || 'EGP'}`;
    const discTxt = d >= 5 ? ` (خصم ${d}%)` : '';
    return `• ${p.title} — ${priceTxt}${discTxt}\n  ${buildGoLink(p)}`;
  });

  return {
    text: `دي أقوى العروض اللي لقيتهالك دلوقتي:\n\n${lines.join('\n\n')}`,
    products: top.map(p => ({ id: p.id, title: p.title, price: p.price, store: p.store }))
  };
}

export default { isDealQuery, buildDealReply, BOT_ID, BOT_NAME };
