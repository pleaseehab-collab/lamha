#!/usr/bin/env node
/**
 * تحديث deals.json من الـ CLI — نفس محرك السيرفر (src/deals/dealsUpdater.js).
 *
 *   node update-deals.mjs                    # يحدّث + يصنّف (محلي، والـ AI لو AI_API_KEY متظبط)
 *   node update-deals.mjs --publish          # يحدّث وينشر (DEALS_AUTO_PUBLISH=telegram,facebook,whatsapp)
 *   node update-deals.mjs --post-telegram    # اسم قديم لـ --publish
 *   node update-deals.mjs --reclassify       # يعيد تصنيف كل المنتجات
 *
 * مصادر البيانات (feeds رسمية من لوحة الأفيليت — مفيش scraping):
 *   DEALS_FEED_AMAZON_URL, DEALS_FEED_ALIEXPRESS_URL, DEALS_FEED_TEMU_URL
 * بدون feed، بيتصنّف الموجود بس ومنتجات كل متجر بتفضل زي ما هي.
 * جدولة: DEALS_AUTO_UPDATE=true في .env (السيرفر بيشغّله يومياً) أو cron: 0 6 * * *
 */
import 'dotenv/config';
import { runUpdate, configFromEnv } from './src/deals/dealsUpdater.js';
import { publishToFacebook } from './src/publishing/facebookPublisher.js';
import { publishToWhatsapp } from './src/publishing/whatsappPublisher.js';

const args = process.argv.slice(2);
const report = await runUpdate({
  config: configFromEnv(),
  publish: args.includes('--publish') || args.includes('--post-telegram'),
  reclassify: args.includes('--reclassify'),
  publishers: { facebook: publishToFacebook, whatsapp: publishToWhatsapp }
});
console.log(JSON.stringify(report, null, 2));
