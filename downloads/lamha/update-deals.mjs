#!/usr/bin/env node
/**
 * تحديث يومي لـ deals.json (Node 18+ بدون أي مكتبات).
 *
 * التشغيل:
 *   node update-deals.mjs                    # يحدّث الملف
 *   node update-deals.mjs --post-telegram    # يحدّث وينشر أقوى 3 عروض على قناة تيليجرام
 *
 * جدولة يومية (cron، الساعة 6 صباحًا):
 *   0 6 * * *  cd /path/to/lamha && node update-deals.mjs --post-telegram
 *
 * متغيرات البيئة للنشر على تيليجرام (اختياري):
 *   TELEGRAM_BOT_TOKEN   توكن البوت من @BotFather
 *   TELEGRAM_CHAT_ID     معرّف القناة، مثل @my_channel (البوت لازم يكون أدمن فيها)
 *   SITE_URL             رابط موقعك
 *
 * ⚠️ مهم: مصدر الأسعار لازم يكون واجهات المتاجر الرسمية (API) أو الـ feeds اللي بتديها لك
 * لوحة الأفيليت. سحب الأسعار من صفحات المتاجر (scraping) بيخالف شروطهم وممكن يوقف حسابك.
 * كمان شروط Amazon Associates بتطلب أسعار حديثة ومطابقة للمعروض عندهم.
 */

import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('./src/data/deals.json', import.meta.url);
const STORES = ['amazon', 'temu', 'aliexpress'];
const CATEGORIES = ['electronics', 'phones', 'home', 'fashion', 'beauty'];

/* ------------------------------------------------------------------
 * Adapters: كل متجر ليه دالة ترجّع مصفوفة منتجات بالشكل ده:
 *   { id, store, category, title, image, price, oldPrice, currency:'EGP', url, flash?, reel? }
 * حاليًا كلهم "غير مربوطين". اربط كل واحد بمصدره الرسمي:
 *   - amazon:     Amazon Product Advertising API (بيتطلب حساب Associates مقبول ومبيعات مؤهلة)
 *   - aliexpress: AliExpress Affiliate API (open.aliexpress.com) بعد قبول حسابك في Portals
 *   - temu:       شوف لوحة الأفيليت عندك، لو فيها product feed أو روابط جاهزة حمّلها وحوّلها هنا
 * لو الدالة رمت NOT_CONFIGURED، السكريبت بيسيب منتجات المتجر ده زي ما هي.
 * ------------------------------------------------------------------ */
const adapters = {
  async amazon()     { throw new Error('NOT_CONFIGURED'); },
  async aliexpress() { throw new Error('NOT_CONFIGURED'); },
  async temu()       { throw new Error('NOT_CONFIGURED'); }
};

/* ------------------------------ أدوات ------------------------------ */
const discount = p => (p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

function isValid(p) {
  return p && p.id && p.title && STORES.includes(p.store) && CATEGORIES.includes(p.category)
    && Number(p.price) > 0 && /^https:\/\//.test(p.url || '')
    && (!p.oldPrice || Number(p.oldPrice) >= Number(p.price)); // مفيش "سعر قبل" أقل من السعر الحالي
}

// نهاية اليوم بتوقيت القاهرة، كـ ISO
function endOfDayCairo() {
  const now = new Date();
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const offset = now.getTime() - cairo.getTime();
  cairo.setHours(23, 59, 59, 0);
  return new Date(cairo.getTime() + offset).toISOString();
}

async function postTelegram(products) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat, SITE_URL: site } = process.env;
  if (!token || !chat || !site) { console.log('تخطّيت تيليجرام: ناقص TELEGRAM_BOT_TOKEN أو TELEGRAM_CHAT_ID أو SITE_URL'); return; }
  const top = [...products].sort((a, b) => discount(b) - discount(a)).slice(0, 3);
  const lines = top.map(p => `• ${p.title} بـ ${Number(p.price).toLocaleString('en-US')} ج.م${discount(p) >= 5 ? ` (-${discount(p)}%)` : ''}`);
  const text = `🔥 أقوى عروض النهاردة على لمحة:\n${lines.join('\n')}\n\nشوفها كلها 👇\n${site}`;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false })
  });
  console.log(r.ok ? 'تم النشر على تيليجرام ✅' : 'فشل النشر على تيليجرام: ' + r.status);
}

/* ------------------------------ التشغيل ------------------------------ */
const current = JSON.parse(await readFile(FILE, 'utf8'));
let products = Array.isArray(current.products) ? current.products : [];
let refreshed = 0;

for (const store of STORES) {
  try {
    const fresh = (await adapters[store]()).filter(isValid);
    products = products.filter(p => p.store !== store).concat(fresh);
    refreshed++;
    console.log(`${store}: ${fresh.length} منتج جديد`);
  } catch (e) {
    console.log(e.message === 'NOT_CONFIGURED' ? `${store}: مش مربوط بمصدر بيانات، سيبت منتجاته زي ما هي` : `${store}: فشل التحديث (${e.message})`);
  }
}

products = products.filter(isValid);

// لو مفيش صفقات سريعة متحددة، أقوى 5 خصومات تبقى Flash
if (!products.some(p => p.flash)) {
  [...products].sort((a, b) => discount(b) - discount(a)).slice(0, 5).forEach(p => { p.flash = true; });
}

const out = {
  ...current,
  // البيانات بتبقى "حقيقية" بس لما متجر واحد على الأقل اتحدث من مصدره الرسمي
  sample: refreshed > 0 ? false : current.sample,
  updatedAt: new Date().toISOString(),
  flashEndsAt: endOfDayCairo(),
  products
};

await writeFile(FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`تم الحفظ: ${products.length} منتج، آخر تحديث ${out.updatedAt}`);

if (process.argv.includes('--post-telegram')) {
  if (out.sample) console.log('تخطّيت النشر: البيانات لسه تجريبية.');
  else await postTelegram(products);
}
