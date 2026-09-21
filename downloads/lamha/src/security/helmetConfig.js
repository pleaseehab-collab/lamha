import helmet from 'helmet';

/**
 * إعدادات Helmet — مضبوطة عشان تسمح بتحميل صور المنتجات من مصادر خارجية
 * (زي Unsplash في shop.html) لكن تمنع حقن سكريبتات خارجية غير موثوقة.
 */
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'wss:', 'https:']
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
});

export default helmetConfig;
