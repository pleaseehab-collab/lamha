import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEALS_FILE = fileURLToPath(new URL('../data/deals.json', import.meta.url));
const router = Router();

let cache = null;
let cacheAt = 0;
const CACHE_MS = 15_000; // نتفادى قراءة الملف من الديسك على كل ريكوست

async function loadDeals() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  const raw = await readFile(DEALS_FILE, 'utf8');
  cache = JSON.parse(raw);
  cacheAt = now;
  return cache;
}

router.get('/deals', async (req, res, next) => {
  try {
    const data = await loadDeals();
    const { store, category, flash } = req.query;
    let products = data.products || [];
    if (store && store !== 'all') products = products.filter(p => p.store === store);
    if (category && category !== 'all') products = products.filter(p => p.category === category);
    if (flash === '1' || flash === 'true') products = products.filter(p => p.flash);
    res.json({ ...data, products });
  } catch (err) {
    next(err);
  }
});

router.get('/deals/:id', async (req, res, next) => {
  try {
    const data = await loadDeals();
    const product = (data.products || []).find(p => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: 'المنتج مش موجود' });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// بيسمح لأجزاء تانية من السيرفر (مساعد العروض الذكي في الشات) تستخدم نفس الكاش
export async function getDealsData() {
  return loadDeals();
}

export default router;
