/**
 * هيدرز الخصوصية وإخفاء تفاصيل البيئة:
 *  - Permissions-Policy: بيمنع الموقع الجغرافي (GPS) والكاميرا والميكروفون وباقي
 *    الـ APIs الحساسة تماماً على الصفحة وأي iframe فيها → المتصفح مش هيسأل المستخدم
 *    عن الموقع أصلاً، حتى لو كود مضاف بالغلط طلبه.
 *  - إزالة X-Powered-By وServer وأي هيدر بيكشف التقنية/النسخة.
 *  - Referrer-Policy: no-referrer عشان روابط الخروج متكشفش صفحة المصدر.
 *
 * ⚠️ حدود الحماية: ده بيمنع واجهة الموقع الجغرافي في المتصفح. موقعك التقريبي
 * ممكن يتستنتج من عنوان الـ IP على مستوى الشبكة — ده بره نطاق أي موقع ويب
 * (الحل: VPN/Tor).
 */
export const PERMISSIONS_POLICY = [
  'geolocation=()', 'camera=()', 'microphone=()', 'payment=()', 'usb=()',
  'bluetooth=()', 'serial=()', 'hid=()', 'magnetometer=()', 'gyroscope=()',
  'accelerometer=()', 'ambient-light-sensor=()', 'display-capture=()',
  'idle-detection=()', 'interest-cohort=()', 'browsing-topics=()'
].join(', ');

export function privacyHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

export default privacyHeaders;
