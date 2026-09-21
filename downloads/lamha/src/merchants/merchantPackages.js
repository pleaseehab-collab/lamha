/**
 * باقات التجار — تحكم في حدود محرك النشر التلقائي.
 * الأسعار هنا مرجعية فقط (المصدر الحقيقي للفوترة يبقى بوابة دفع خارجية —
 * ده مش محرك دفع/اشتراكات، ده بس تعريف الحدود المرتبطة بكل باقة).
 */

export const PACKAGES = {
  basic: {
    id: 'basic',
    label: 'الباقة الأساسية',
    priceUSD: 50,
    platforms: ['telegram'],
    dailyPostLimit: 10,
    priority: false
  },
  pro: {
    id: 'pro',
    label: 'الباقة الاحترافية',
    priceUSD: 150,
    platforms: ['telegram', 'facebook', 'whatsapp'],
    dailyPostLimit: 100,
    priority: true
  }
};

export function getPackage(id) {
  return PACKAGES[id] || null;
}

export function isPlatformAllowed(packageId, platform) {
  const pkg = getPackage(packageId);
  return !!pkg && pkg.platforms.includes(platform);
}

export default { PACKAGES, getPackage, isPlatformAllowed };
