import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { classifyProducts, CATEGORIES } from './aiClassifier.js';

/**
 * محرك تحديث العروض — بيتشغّل من CLI (update-deals.mjs) ومن السيرفر (scheduler + لوحة /admin).
 *
 * مصادر البيانات (مصدر رسمي فقط — مفيش scraping):
 *   DEALS_FEED_AMAZON_URL / DEALS_FEED_ALIEXPRESS_URL / DEALS_FEED_TEMU_URL
 *   = رابط HTTPS بيرجّع JSON (مصفوفة أو {products:[...]}) من لوحة الأفيليت أو
 *   وسيط عندك. كل عنصر: { id, title, image, price, oldPrice?, url, category?, flash?, reel? }
 *
 * الحماية: الرابط لازم HTTPS ومن دومين المتجر نفسه (detectStore) عشان feed
 * مخترق ميحقنش روابط خبيثة؛ بيتحوّل لرابط أفيليت؛ الأسعار بتتفحص؛ حجم الرد محدود.
 */

export const DEALS_FILE = fileURLToPath(new URL('../data/deals.json', import.meta.url));
export const STORES = ['amazon', 'temu', 'aliexpress'];
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 500;

export const discount = p => (p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0);

export function isValid(p) {
  return !!(p && p.id && p.title && STORES.includes(p.store) && CATEGORIES.includes(p.category)
    && Number(p.price) > 0 && /^https:\/\//.test(p.url || '')
    && (!p.oldPrice || Number(p.oldPrice) >= Number(p.price)));
}

export function endOfDayCairo(now = new Date()) {
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const offset = now.getTime() - cairo.getTime();
  cairo.setHours(23, 59, 59, 0);
  return new Date(cairo.getTime() + offset).toISOString();
}

export function configFromEnv(env = process.env) {
  return {
    feeds: Object.fromEntries(STORES.map(s => [s, env[`DEALS_FEED_${s.toUpperCase()}_URL`] || ''])),
    ai: { apiKey: env.AI_API_KEY || '', model: env.AI_MODEL || 'claude-haiku-4-5-20251001' },
    telegram: { token: env.TELEGRAM_BOT_TOKEN || '', chatId: env.TELEGRAM_CHAT_ID || '', siteUrl: env.SITE_URL || '' },
    autoPublish: (env.DEALS_AUTO_PUBLISH || '').split(',').map(s => s.trim()).filter(Boolean)
  };
}

async function fetchFeed(store, url, { fetchImpl, detectStore, convertLink }) {
  if (!/^https:\/\//.test(url)) throw new Error('رابط الـ feed لازم HTTPS');
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`feed status ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('feed أكبر من المسموح');
  const json = JSON.parse(text);
  const rows = (Array.isArray(json) ? json : json.products || []).slice(0, MAX_ITEMS);

  const items = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (detectStore(r.url) !== store) continue; // الرابط لازم يبقى من دومين المتجر نفسه
    const link = convertLink(r.url);
    if (!link?.webUrl) continue;
    items.push({
      id: `${store}-${String(r.id ?? '').replace(/[^\w-]/g, '').slice(0, 40)}`,
      store,
      category: CATEGORIES.includes(r.category) ? r.category : undefined,
      currency: 'EGP',
      title: String(r.title || '').replace(/[<>]/g, '').trim().slice(0, 200),
      image: /^https:\/\//.test(r.image || '') ? r.image : '',
      price: Number(r.price),
      oldPrice: Number(r.oldPrice) || 0,
      url: link.webUrl,
      ...(r.flash ? { flash: true } : {}),
      ...(r.reel ? { reel: true } : {})
    });
  }
  return items;
}

async function postTelegramSummary(products, cfg, fetchImpl) {
  const { token, chatId, siteUrl } = cfg.telegram;
  if (!token || !chatId || !siteUrl) return { ok: false, skipped: true };
  const top = [...products].sort((a, b) => discount(b) - discount(a)).slice(0, 3);
  const lines = top.map(p => `• ${p.title} بـ ${Number(p.price).toLocaleString('en-US')} ج.م${discount(p) >= 5 ? ` (-${discount(p)}%)` : ''}`);
  const text = `🔥 أقوى عروض النهاردة على لمحة:\n${lines.join('\n')}\n\nشوفها كلها 👇\n${siteUrl}`;
  const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  return { ok: r.ok, status: r.status };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.publish]     ينشر بعد التحديث على المنصات المفعّلة (DEALS_AUTO_PUBLISH)
 * @param {boolean} [opts.reclassify]  يعيد تصنيف كل المنتجات (مش الناقص بس)
 */
export async function runUpdate({ file = DEALS_FILE, config = configFromEnv(), fetchImpl = fetch, publish = false, reclassify = false, detectStore, convertLink, publishers } = {}) {
  if (!detectStore || !convertLink) {
    const eng = await import('../affiliate/affiliateEngine.js');
    detectStore ||= eng.detectStore;
    convertLink ||= eng.convertAffiliateLink;
  }

  const current = JSON.parse(await readFile(file, 'utf8'));
  let products = Array.isArray(current.products) ? current.products : [];
  const report = { stores: {}, ai: null, published: {}, total: 0 };
  let refreshed = 0;

  for (const store of STORES) {
    const url = config.feeds[store];
    if (!url) { report.stores[store] = 'not_configured'; continue; }
    try {
      const fresh = await fetchFeed(store, url, { fetchImpl, detectStore, convertLink });
      // التصنيف (محلي + AI اختياري) قبل الفلترة
      const { products: classified, stats } = await classifyProducts(fresh, { ...config.ai, fetchImpl, reclassify });
      report.ai = { ...(report.ai || {}), [store]: stats };
      const valid = classified.filter(isValid);
      products = products.filter(p => p.store !== store).concat(valid);
      refreshed++;
      report.stores[store] = { fetched: fresh.length, accepted: valid.length };
    } catch (e) {
      report.stores[store] = { error: e.message }; // منتجات المتجر القديمة بتفضل زي ما هي
    }
  }

  // تصنيف/تنظيف الموجود: اللي مالوش تصنيف صالح بس (أو الكل مع reclassify)
  const re = await classifyProducts(products, { ...config.ai, fetchImpl, reclassify });
  products = re.products.filter(isValid);

  if (!products.some(p => p.flash)) {
    [...products].sort((a, b) => discount(b) - discount(a)).slice(0, 5).forEach(p => { p.flash = true; });
  }

  const out = {
    ...current,
    sample: refreshed > 0 ? false : current.sample,
    updatedAt: new Date().toISOString(),
    flashEndsAt: endOfDayCairo(),
    products
  };
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(out, null, 2) + '\n');
  await rename(tmp, file); // كتابة ذرّية
  report.total = products.length;
  report.sample = out.sample;

  if (publish) {
    if (out.sample) report.published = { skipped: 'البيانات لسه تجريبية' };
    else {
      const platforms = config.autoPublish;
      if (platforms.includes('telegram')) report.published.telegram = await postTelegramSummary(products, config, fetchImpl);
      const top = [...products].sort((a, b) => discount(b) - discount(a))[0];
      for (const name of platforms.filter(p => p !== 'telegram')) {
        const fn = publishers?.[name];
        if (top && fn) report.published[name] = await fn(top).catch(e => ({ ok: false, error: e.message }));
      }
    }
  }
  return report;
}

let running = false;
/** نسخة بتمنع تشغيل تحديثين في نفس الوقت */
export async function runUpdateExclusive(opts) {
  if (running) return { busy: true };
  running = true;
  try { return await runUpdate(opts); } finally { running = false; }
}

export default { runUpdate, runUpdateExclusive, configFromEnv, isValid };
