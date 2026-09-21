import { logger } from '../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'المسار غير موجود.' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  logger.error('خطأ غير متوقع', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'حصل خطأ في السيرفر.' : err.message
  });
}
