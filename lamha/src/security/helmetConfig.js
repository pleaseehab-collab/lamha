import helmet from 'helmet';
import { env } from '../config/env.js';

/**
 * إعدادات Helmet — مضبوطة لواجهة shop.html:
 *  - الصور من أي HTTPS (Unsplash...) و data:
 *  - سكريبت/ستايل inline (الواجهة ملف HTML واحد)
 *  - خطوط Google Fonts (ستايل من fonts.googleapis.com + ملفات من fonts.gstatic.com)
 *
 * ⚠️ مهم للتطوير على http://localhost أو IP الشبكة (زي Termux):
 * الـ CSP الافتراضي في Helmet فيه `upgrade-insecure-requests` وHSTS وCOOP،
 * وده بيكسر التحميل على HTTP عادي (المتصفح بيحاول يحوّل طلبات /api لـ https
 * فتفشل). فبنفعّلهم في production بس (لما تكون ورا HTTPS فعلاً).
 */
const isProd = env.NODE_ENV === 'production';

export const helmetConfig = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
      upgradeInsecureRequests: isProd ? [] : null
    }
  },
  hsts: isProd,
  crossOriginOpenerPolicy: isProd ? { policy: 'same-origin' } : false,
  originAgentCluster: isProd,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
});

export default helmetConfig;
