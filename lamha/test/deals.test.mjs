import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { heuristicCategory, classifyProducts, classifyWithAI } = await import('../src/deals/aiClassifier.js');
const { runUpdate, isValid } = await import('../src/deals/dealsUpdater.js');

const detectStore = url => { try { const h = new URL(url).hostname; return h.endsWith('amazon.eg') ? 'amazon' : 'unknown'; } catch { return null; } };
const convertLink = url => ({ webUrl: `${url}${url.includes('?') ? '&' : '?'}tag=test-21` });

test('classifier: heuristic covers Arabic and English titles', () => {
  assert.equal(heuristicCategory('سماعات بلوتوث لاسلكية'), 'electronics');
  assert.equal(heuristicCategory('Samsung smartphone 128GB'), 'phones');
  assert.equal(heuristicCategory('ماكينة قهوة بالكبسولات'), 'home');
  assert.equal(heuristicCategory('حذاء رياضي خفيف'), 'fashion');
  assert.equal(heuristicCategory('سيروم فيتامين C للوجه'), 'beauty');
  assert.equal(heuristicCategory('zzz qqq'), null);
});

test('classifier: AI output is strictly validated (unknown ids/categories ignored, fallback safe)', async () => {
  const items = [{ id: 'a1', title: 'xx' }, { id: 'a2', title: 'yy' }, { id: 'a3', title: 'zz' }];
  const fetchImpl = async (url, opts) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(opts.headers['x-api-key'], 'k');
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: '```json\n[{"id":"a1","category":"beauty"},{"id":"evil","category":"phones"},{"id":"a2","category":"hacked"}]\n```' }] }) };
  };
  const map = await classifyWithAI(items, { apiKey: 'k', model: 'm', fetchImpl });
  assert.deepEqual([...map.entries()], [['a1', 'beauty']]);

  const { products, stats } = await classifyProducts(items, { apiKey: 'k', model: 'm', fetchImpl });
  assert.equal(products.find(p => p.id === 'a1').category, 'beauty');
  assert.equal(products.find(p => p.id === 'a2').category, 'home');
  assert.equal(stats.ai, 1);
  assert.equal(stats.fallback, 2);
});

test('classifier: network/JSON failure or missing key never throws', async () => {
  const bad = async () => { throw new Error('offline'); };
  assert.equal((await classifyWithAI([{ id: 'x', title: 't' }], { apiKey: 'k', fetchImpl: bad })).size, 0);
  assert.equal((await classifyWithAI([{ id: 'x', title: 't' }], { apiKey: '', fetchImpl: bad })).size, 0);
  const junk = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'not json' }] }) });
  assert.equal((await classifyWithAI([{ id: 'x', title: 't' }], { apiKey: 'k', fetchImpl: junk })).size, 0);
});

function tmpDeals(extra = {}) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deals-')), 'deals.json');
  fs.writeFileSync(f, JSON.stringify({ sample: true, updatedAt: null, products: [
    { id: 'old1', store: 'temu', category: 'home', currency: 'EGP', title: 'منظم مكياج', price: 150, oldPrice: 310, url: 'https://temu.to/k/x' }
  ], ...extra }));
  return f;
}

test('updater: feed import validates domain, converts links, classifies, keeps other stores, atomic write', async () => {
  const file = tmpDeals();
  const feed = [
    { id: '1', title: 'سماعات بلوتوث', image: 'https://img.test/a.jpg', price: 500, oldPrice: 900, url: 'https://www.amazon.eg/dp/B0AAA' },
    { id: '2', title: 'سيروم للبشرة', image: 'http://insecure/a.jpg', price: 100, url: 'https://www.amazon.eg/dp/B0BBB' },
    { id: '3', title: 'منتج بدون كلمات', price: 50, url: 'https://www.amazon.eg/dp/B0CCC' },
    { id: '4', title: 'رابط خبيث', price: 50, url: 'https://evil.example.com/steal' },
    { id: '5', title: 'سعر غلط', price: -5, url: 'https://www.amazon.eg/dp/B0DDD' },
    { id: '6', title: 'سعر قديم أقل', price: 100, oldPrice: 50, url: 'https://www.amazon.eg/dp/B0EEE' }
  ];
  const fetchImpl = async url => {
    assert.equal(url, 'https://feed.test/amazon.json');
    return { ok: true, text: async () => JSON.stringify(feed) };
  };
  const config = { feeds: { amazon: 'https://feed.test/amazon.json', aliexpress: '', temu: '' }, ai: { apiKey: '' }, telegram: {}, autoPublish: [] };
  const report = await runUpdate({ file, config, fetchImpl, detectStore, convertLink });
  assert.equal(report.stores.amazon.fetched, 5); // الخبيث اتشال قبل العد
  assert.equal(report.stores.amazon.accepted, 3);
  assert.equal(report.stores.temu, 'not_configured');
  const out = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(out.sample, false);
  assert.ok(out.products.some(p => p.id === 'old1'), 'منتجات المتاجر غير المحدّثة بتفضل');
  const a1 = out.products.find(p => p.id === 'amazon-1');
  assert.equal(a1.category, 'electronics');
  assert.ok(a1.url.includes('tag=test-21'));
  assert.equal(out.products.find(p => p.id === 'amazon-2').image, '');
  assert.equal(out.products.find(p => p.id === 'amazon-3').category, 'home');
  assert.ok(!out.products.some(p => /evil/.test(p.url)));
  assert.ok(out.products.every(isValid));
  assert.ok(out.products.some(p => p.flash), 'flash deals set');
  assert.ok(!fs.existsSync(file + '.tmp'));
});

test('updater: failing feed keeps existing products; non-https feed refused', async () => {
  const file = tmpDeals();
  const config = { feeds: { amazon: 'https://feed.test/x', aliexpress: 'http://plain.test/x', temu: '' }, ai: {}, telegram: {}, autoPublish: [] };
  const fetchImpl = async () => { throw new Error('boom'); };
  const report = await runUpdate({ file, config, fetchImpl, detectStore, convertLink });
  assert.match(report.stores.amazon.error, /boom/);
  assert.match(report.stores.aliexpress.error, /HTTPS/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).products.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sample, true); // لسه تجريبي
});

test('updater: publish skipped for sample data; publishes to configured platforms for real data', async () => {
  const file = tmpDeals({ sample: false });
  const calls = [];
  const publishers = { facebook: async d => { calls.push(['fb', d.id]); return { ok: true }; } };
  const tgCalls = [];
  const fetchImpl = async (url, opts) => { tgCalls.push(url); return { ok: true, status: 200 }; };
  const config = { feeds: { amazon: '', aliexpress: '', temu: '' }, ai: {}, telegram: { token: 'T', chatId: 'C', siteUrl: 'https://x.test' }, autoPublish: ['telegram', 'facebook'] };
  const rep = await runUpdate({ file, config, fetchImpl, detectStore, convertLink, publish: true, publishers });
  assert.equal(rep.published.telegram.ok, true);
  assert.ok(tgCalls[0].startsWith('https://api.telegram.org/botT/'));
  assert.deepEqual(calls, [['fb', 'old1']]);

  const sampleFile = tmpDeals(); // sample:true
  const rep2 = await runUpdate({ file: sampleFile, config, fetchImpl, detectStore, convertLink, publish: true, publishers });
  assert.ok(rep2.published.skipped);
});
