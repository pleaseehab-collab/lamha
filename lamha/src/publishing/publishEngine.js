import * as userStore from '../users/userStore.js';
import { getPackage, isPlatformAllowed } from '../merchants/merchantPackages.js';
import { publishToTelegram } from './telegramPublisher.js';
import { publishToFacebook } from './facebookPublisher.js';
import { publishToWhatsapp } from './whatsappPublisher.js';
import { logger } from '../utils/logger.js';

/**
 * محرك النشر التلقائي — بيوزّع عرض على المنصات المسموح بيها حسب باقة
 * التاجر، وبيفرض حد أقصى يومي لكل تاجر (dailyPostLimit) عشان يمنع
 * استخدام الباقة الأساسية كأنها احترافية (abuse).
 *
 * ⚠️ عداد النشر اليومي هنا في الذاكرة (Phase 1) — للإنتاج الحقيقي
 * انقله لقاعدة بيانات/Redis عشان يفضل متسق بين restarts وأكتر من نسخة.
 */

const dailyCounters = new Map(); // `${merchantId}:${yyyy-mm-dd}` -> count

const PUBLISHERS = {
  telegram: publishToTelegram,
  facebook: publishToFacebook,
  whatsapp: publishToWhatsapp
};

function todayKey(merchantId) {
  return `${merchantId}:${new Date().toISOString().slice(0, 10)}`;
}

export async function publishDeal(deal, { merchantId, platforms }) {
  const merchant = userStore.findById(merchantId);
  if (!merchant || merchant.role !== 'merchant' || !merchant.merchant?.package) {
    return { ok: false, error: 'التاجر مش مشترك في أي باقة نشر.' };
  }

  const pkg = getPackage(merchant.merchant.package);
  if (!pkg) return { ok: false, error: 'باقة غير معروفة.' };

  const key = todayKey(merchantId);
  const usedToday = dailyCounters.get(key) || 0;
  if (usedToday >= pkg.dailyPostLimit) {
    return { ok: false, error: `تجاوزت الحد اليومي للباقة (${pkg.dailyPostLimit} منشور/يوم).` };
  }

  const requestedPlatforms = (platforms && platforms.length ? platforms : pkg.platforms)
    .filter(p => PUBLISHERS[p]);

  const results = {};
  for (const platform of requestedPlatforms) {
    if (!isPlatformAllowed(pkg.id, platform)) {
      results[platform] = { ok: false, error: `الباقة (${pkg.label}) ملهاش صلاحية النشر على ${platform}.` };
      continue;
    }
    try {
      results[platform] = await PUBLISHERS[platform](deal);
    } catch (err) {
      logger.error('خطأ غير متوقع في محرك النشر', { platform, error: err.message });
      results[platform] = { ok: false, error: err.message };
    }
  }

  dailyCounters.set(key, usedToday + 1);
  return { ok: true, results, remainingToday: pkg.dailyPostLimit - (usedToday + 1) };
}

export default { publishDeal };
