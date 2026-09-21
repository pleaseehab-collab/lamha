import { runUpdateExclusive } from './dealsUpdater.js';
import { logger } from '../utils/logger.js';

/**
 * جدولة يومية جوه السيرفر: بتشغّل تحديث العروض كل يوم الساعة DEALS_UPDATE_HOUR_CAIRO
 * بتوقيت القاهرة (بدل cron خارجي). بتتفعّل بـ DEALS_AUTO_UPDATE=true.
 */
const cairoHour = () => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Africa/Cairo' }).format(new Date())) % 24;

export function startDealsScheduler({ hour, publish, publishers }) {
  let lastRunDay = '';
  const tick = async () => {
    const day = new Date().toISOString().slice(0, 10);
    if (cairoHour() !== hour || lastRunDay === day) return;
    lastRunDay = day;
    try {
      const report = await runUpdateExclusive({ publish: publish.length > 0, publishers });
      logger.info('تحديث العروض التلقائي خلص', report);
    } catch (err) {
      logger.error('فشل تحديث العروض التلقائي', { message: err.message });
    }
  };
  const timer = setInterval(tick, 5 * 60 * 1000); // فحص كل 5 دقايق
  timer.unref?.();
  logger.info(`جدولة تحديث العروض مفعّلة: يومياً الساعة ${hour}:00 بتوقيت القاهرة`);
  return () => clearInterval(timer);
}
