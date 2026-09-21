/**
 * RBAC بسيط — أدوار المنصة: user, merchant, moderator, admin.
 * لازم يتستخدم بعد requireAuth (محتاج req.user متعرّف).
 */

export const ROLES = ['user', 'merchant', 'moderator', 'admin'];

export function requireRole(...allowed) {
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'محتاج تسجيل دخول.' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'مفيش صلاحية كافية للعملية دي.' });
    }
    next();
  };
}

export function isAdmin(user) {
  return !!user && user.role === 'admin';
}

export default { ROLES, requireRole, isAdmin };
