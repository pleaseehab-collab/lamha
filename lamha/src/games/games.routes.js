import { Router } from 'express';
import * as pointsSystem from './pointsSystem.js';
import * as wheel from './engines/wheel.js';
import * as lobbyManager from './lobbyManager.js';
import pool from './engines/pool.js';
import ludo from './engines/ludo.js';
import domino from './engines/domino.js';
import uno from './engines/uno.js';
import { requireAuth } from '../security/auth.js';

const router = Router();

// دلوقتي بيستخدم JWT حقيقي (requireAuth) بدل هيدر x-user-id اللي كان
// بيوثق في أي قيمة يبعتها العميل من غير أي تحقق.
function requireUserId(req, res, next) {
  requireAuth(req, res, () => {
    req.userId = req.user.id;
    next();
  });
}

router.get('/games/points/balance', requireUserId, (req, res) => {
  res.json({ balance: pointsSystem.getBalance(req.userId), history: pointsSystem.getHistory(req.userId) });
});

router.get('/games/points/coupons', requireUserId, (req, res) => {
  res.json({ coupons: pointsSystem.listCoupons(req.userId) });
});

router.post('/games/points/coupons/:code/redeem', requireUserId, (req, res) => {
  const result = pointsSystem.redeemCoupon(req.params.code, req.userId);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

router.get('/games/wheel/status', requireUserId, (req, res) => {
  res.json({ ...wheel.canSpin(req.userId), prizes: wheel.prizeList() });
});

router.post('/games/wheel/spin', requireUserId, (req, res) => {
  const result = wheel.spin(req.userId);
  if (!result.ok) return res.status(429).json(result);
  res.json(result);
});

// --- كتالوج الألعاب والوبيهات (عام، بدون تسجيل دخول) ---
const CATALOG = [ludo, domino, uno, pool].map(e => e.meta);

router.get('/games/catalog', (req, res) => {
  res.json({ games: [...CATALOG, { id: 'wheel', name: 'عجلة الحظ', minPlayers: 1, maxPlayers: 1 }] });
});

router.get('/games/lobbies', (req, res) => {
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  res.json({ lobbies: lobbyManager.listLobbies(type) });
});

export default router;
