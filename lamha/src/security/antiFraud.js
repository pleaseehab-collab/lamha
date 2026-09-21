import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * حماية نقرات الأفيليت من الاحتيال/البوتات — Phase 1.
 *
 * ⚠️ الحالة اتخزّنة في الذاكرة (Map) وبتتصفّر لو السيرفر اتعمله restart، ولو
 * شغّال أكتر من نسخة (instance) في نفس الوقت مش هتبقى متزامنة بينهم. للإنتاج
 * الحقيقي على أكتر من سيرفر، استبدل الـ Map دي بـ Redis (INCR + EXPIRE) عشان
 * تبقى متشاركة بين كل النسخ.
 */

const clickLog = new Map(); // fingerprint -> [timestamps]
const CLEAN_INTERVAL_MS = 5 * 60_000;
const WINDOW_MS = env.security.clickRateLimitWindowMs;
const MAX_CLICKS = env.security.clickRateLimitMax;

// توقيعات User-Agent شائعة لبوتات وأدوات آلية (قائمة أساسية قابلة للتوسيع)
const BOT_UA_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /headless/i, /phantomjs/i, /puppeteer/i,
  /curl\//i, /wget\//i, /python-requests/i, /axios\//i, /go-http-client/i,
  /scrapy/i, /httpclient/i
];

function fingerprint(req) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const ua = req.headers['user-agent'] || 'unknown';
  const deviceId = req.headers['x-device-id'] || req.cookies?.deviceId || '';
  const raw = `${ip}|${ua}|${deviceId}`;
  return crypto.createHmac('sha256', env.security.fraudSalt).update(raw).digest('hex');
}

function isSuspiciousUserAgent(ua) {
  if (!ua || ua.trim().length < 5) return true;
  return BOT_UA_PATTERNS.some(rx => rx.test(ua));
}

function recordClick(fp) {
  const now = Date.now();
  const arr = clickLog.get(fp) || [];
  const recent = arr.filter(t => now - t < WINDOW_MS);
  recent.push(now);
  clickLog.set(fp, recent);
  return recent.length;
}

/**
 * Middleware: يتحقق من النقرة قبل ما نعمل redirect لرابط الأفيليت الحقيقي.
 * بيحط على req.fraud نتيجة الفحص عشان لوج/راوت بعده يقرر يعمل ايه.
 */
export function antiFraudGuard(req, res, next) {
  const ua = req.headers['user-agent'] || '';
  const fp = fingerprint(req);
  const clicksInWindow = recordClick(fp);
  const suspiciousUa = isSuspiciousUserAgent(ua);
  const tooManyClicks = clicksInWindow > MAX_CLICKS;
  const isSuspicious = suspiciousUa || tooManyClicks;

  req.fraud = { fingerprint: fp, clicksInWindow, suspiciousUa, tooManyClicks, isSuspicious };

  if (isSuspicious) {
    logger.warn('نقرة أفيليت مشبوهة', {
      fp: fp.slice(0, 12),
      clicksInWindow,
      suspiciousUa,
      ua: ua.slice(0, 120)
    });
  }

  // ملاحظة: هنا بنسمح بمرور الطلب لكن بنعلّمه كمشبوه، عشان الراوت اللي بعده
  // (routes/go.routes.js مثلاً) يقرر: يوجّه لصفحة المنتج العادية (من غير تاج
  // الأفيليت) بدل الرابط اللي بيحسب عمولة، بدل ما يمنع المستخدم تماماً.
  next();
}

// تنضيف دوري للذاكرة عشان متكبرش من غير داعي
setInterval(() => {
  const now = Date.now();
  for (const [fp, arr] of clickLog.entries()) {
    const recent = arr.filter(t => now - t < WINDOW_MS);
    if (recent.length === 0) clickLog.delete(fp);
    else clickLog.set(fp, recent);
  }
}, CLEAN_INTERVAL_MS).unref();

export function _debugClickLogSize() {
  return clickLog.size;
}
