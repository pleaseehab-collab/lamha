import 'dotenv/config';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function list(value, fallback = []) {
  if (!value) return fallback;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: num(process.env.PORT, 3000),
  SITE_URL: process.env.SITE_URL || 'http://localhost:3000',
  CORS_ORIGINS: list(process.env.CORS_ORIGINS, ['http://localhost:3000']),

  affiliate: {
    amazonTag: process.env.AMAZON_EG_TAG || '',
    aliexpressTrackingId: process.env.ALIEXPRESS_AFF_TRACKING_ID || '',
    aliexpressAppKey: process.env.ALIEXPRESS_APP_KEY || '',
    aliexpressAppSecret: process.env.ALIEXPRESS_APP_SECRET || '',
    temuAffId: process.env.TEMU_AFF_ID || ''
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || ''
  },

  facebook: {
    pageId: process.env.FACEBOOK_PAGE_ID || '',
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || ''
  },

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    recipients: list(process.env.WHATSAPP_RECIPIENTS, [])
  },

  // ذكاء اصطناعي لتصنيف/تحديث العروض (Anthropic Messages API) — اختياري.
  // من غير مفتاح، التصنيف بيشتغل بالكلمات المفتاحية (محلياً بدون إنترنت).
  ai: {
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-haiku-4-5-20251001'
  },

  // تحديث العروض التلقائي (scheduler جوه السيرفر)
  deals: {
    autoUpdate: process.env.DEALS_AUTO_UPDATE === 'true',
    updateHourCairo: num(process.env.DEALS_UPDATE_HOUR_CAIRO, 6),
    autoPublish: list(process.env.DEALS_AUTO_PUBLISH, []) // telegram,facebook,whatsapp
  },

  // ⚠️ رقم الواتساب بتاع الإعلانات بيتقري من هنا بس ومبيتبعتش للعميل أبداً؛
  // الزائر بيروح لـ /api/ads/contact (تحويل من السيرفر).
  contact: {
    adsWhatsapp: (process.env.ADS_WHATSAPP_NUMBER || '').replace(/\D/g, '')
  },

  aiModeration: {
    apiKey: process.env.AI_MODERATION_API_KEY || '',
    endpoint: process.env.AI_MODERATION_ENDPOINT || ''
  },

  revenue: {
    sellerSharePct: num(process.env.REVENUE_SELLER_SHARE_PCT, 60),
    platformSharePct: num(process.env.REVENUE_PLATFORM_SHARE_PCT, 40),
    referralSharePct: num(process.env.REVENUE_REFERRAL_SHARE_PCT, 10),
    webhookSecret: process.env.REVENUE_WEBHOOK_SECRET || ''
  },

  security: {
    fraudSalt: process.env.FRAUD_SALT || 'dev-only-insecure-salt-change-me',
    clickRateLimitMax: num(process.env.CLICK_RATE_LIMIT_MAX, 8),
    clickRateLimitWindowMs: num(process.env.CLICK_RATE_LIMIT_WINDOW_MS, 60_000),
    jwtSecret: process.env.JWT_SECRET || 'dev-only-insecure-jwt-secret-change-me',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-only-insecure-refresh-secret-change-me',
    jwtAccessTtlSec: num(process.env.JWT_ACCESS_TTL_SEC, 15 * 60),
    jwtRefreshTtlSec: num(process.env.JWT_REFRESH_TTL_SEC, 30 * 24 * 60 * 60),
    // قائمة الـ IPs المسموح لها تنادي على راوتس الأدمن (لوحة التحكم الحصينة).
    // فاضية = مفيش قيد (مناسب للتطوير بس؛ في الإنتاج لازم تتحدد صراحة).
    adminIpWhitelist: list(process.env.ADMIN_IP_WHITELIST, []),
    // hash كلمة سر لوحة /admin (scrypt) — ولّده بـ: npm run admin:password
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || ''
  },

  revenueLimits: {
    // أي عمولة واردة من الـ webhook أعلى من الرقم ده بترفض تلقائيًا وتتسجل
    // كحدث أمني للمراجعة اليدوية، عشان تمنع استغلال سر الـ webhook لو
    // اتسرب، أو باگ في نظام الشركاء يبعت قيمة غير منطقية.
    maxCommissionEGP: num(process.env.REVENUE_MAX_COMMISSION_EGP, 50_000)
  },

  chat: {
    msgLimit: num(process.env.CHAT_MSG_LIMIT, 5),
    msgWindowMs: num(process.env.CHAT_MSG_WINDOW_MS, 10_000),
    muteDefaultSeconds: num(process.env.MUTE_DEFAULT_SECONDS, 120)
  }
};

/**
 * حارس إقلاع: يمنع تشغيل السيرفر في production بمفاتيح سرية افتراضية
 * (اللي هي مكتوبة صراحة في الكود كـ placeholders غير آمنة). لو حد نسي
 * يحط القيم الحقيقية في .env قبل النشر، أحسن إن السيرفر يرفض يشتغل
 * بدل ما يشتغل بمفاتيح الكل عارفها من الكود المفتوح.
 */
const INSECURE_DEFAULTS = [
  ['JWT_SECRET', env.security.jwtSecret, 'dev-only-insecure-jwt-secret-change-me'],
  ['JWT_REFRESH_SECRET', env.security.jwtRefreshSecret, 'dev-only-insecure-refresh-secret-change-me'],
  ['FRAUD_SALT', env.security.fraudSalt, 'dev-only-insecure-salt-change-me']
];

export function assertProductionSecrets() {
  if (env.NODE_ENV !== 'production') return;
  const insecure = INSECURE_DEFAULTS.filter(([, actual, fallback]) => actual === fallback);
  if (insecure.length > 0) {
    const names = insecure.map(([name]) => name).join(', ');
    throw new Error(
      `رفض الإقلاع: متغيرات البيئة دي لسه بالقيمة الافتراضية غير الآمنة في production: ${names}. ` +
      `حدّدها بقيم عشوائية طويلة حقيقية في .env قبل التشغيل.`
    );
  }
  if (env.revenue.webhookSecret.length < 16) {
    throw new Error('رفض الإقلاع: REVENUE_WEBHOOK_SECRET غير محدد أو قصير جداً في production.');
  }
  if (!env.security.adminPasswordHash) {
    throw new Error('رفض الإقلاع: ADMIN_PASSWORD_HASH غير محدد في production — شغّل: npm run admin:password');
  }
  if (env.security.adminIpWhitelist.length === 0) {
    throw new Error(
      'رفض الإقلاع: ADMIN_IP_WHITELIST فاضية في production — لازم تحدد IPs مسموح لها بدخول لوحة الأدمن.'
    );
  }
}

export default env;
