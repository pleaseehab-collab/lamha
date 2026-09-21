import { verifyAccessToken } from './jwt.js';
import { findById } from '../users/userStore.js';

/**
 * Middleware مصادقة لسوكتات Socket.io — بيتحقق من JWT حقيقي بدل ما يثق
 * في أي userId بيبعته العميل في الـ handshake (زي ما كان حاصل في
 * gamesSocket.js الأصلي، وهي ثغرة أمنية مباشرة: أي حد كان يقدر يدّعي
 * إنه أي مستخدم تاني ويلعب/يقبض نقاطه).
 *
 * fallback: لو مفيش توكن، بنسمح بـ "زائر" (guest) بـ id عشوائي — مناسب
 * للعجلة/الشات العام، لكن أي عملية ليها قيمة مالية حقيقية (مزادات،
 * عمولات) المفروض تتقفل بـ requireAuth على الـ REST API بتاعها كمان.
 */
export function requireSocketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (token) {
    const { valid, payload } = verifyAccessToken(token);
    if (valid) {
      const user = findById(payload.sub);
      if (user) {
        socket.data.userId = user.id;
        socket.data.role = user.role;
        socket.data.authenticated = true;
        return next();
      }
    }
  }
  // مفيش توكن صالح — زائر مؤقت (مسموح بس هيتحرم من أي عملية محتاجة requireAuth)
  socket.data.userId = `guest_${socket.id}`;
  socket.data.role = 'guest';
  socket.data.authenticated = false;
  next();
}

export default { requireSocketAuth };
