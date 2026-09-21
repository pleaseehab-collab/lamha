import { v4 as uuid } from 'uuid';
import { collection } from '../db/index.js';

/**
 * نظام نقاط/كوبونات مشترك بين كل الألعاب — بيخزّن عن طريق database facade
 * (src/db) فالرصيد بيفضل محفوظ بعد أي restart. لو نقلت الـ facade لـ
 * Postgres/Redis مش هتحتاج تغيّر حاجة هنا.
 */

const balances = collection('points_balances'); // userId -> number
const ledger = collection('points_ledger'); // userId -> [{ id, delta, reason, ts }]
const coupons = collection('points_coupons'); // code -> { userId, tierCode, label, redeemed, issuedAt }

const MAX_LEDGER_ENTRIES = 500; // سقف لتاريخ كل مستخدم عشان الملف ميكبرش للأبد

// عتبات تحويل النقاط لكوبونات خصم حقيقية — عدّلها حسب عروضك
const COUPON_THRESHOLDS = [
  { points: 500, code: 'LAMHA5', label: 'كوبون خصم 5%' },
  { points: 1200, code: 'LAMHA10', label: 'كوبون خصم 10%' },
  { points: 3000, code: 'LAMHA20', label: 'كوبون خصم 20%' }
];

export function getBalance(userId) {
  return balances.get(userId) || 0;
}

export function addPoints(userId, delta, reason = 'game') {
  if (!userId || !Number.isFinite(delta)) return getBalance(userId);
  // الأرصدة مبتنزلش تحت الصفر
  const newBalance = Math.max(0, getBalance(userId) + Math.trunc(delta));
  balances.set(userId, newBalance);
  ledger.update(
    userId,
    history => {
      history.push({ id: uuid(), delta: Math.trunc(delta), reason, ts: Date.now() });
      return history.length > MAX_LEDGER_ENTRIES ? history.slice(-MAX_LEDGER_ENTRIES) : history;
    },
    []
  );
  return newBalance;
}

export function getHistory(userId, limit = 20) {
  return (ledger.get(userId) || []).slice(-limit).reverse();
}

/** يتحقق هل المستخدم وصل لعتبة كوبون جديدة ولسه مستلمهوش */
export function checkAndIssueCoupons(userId) {
  const balance = getBalance(userId);
  const issued = [];
  for (const tier of COUPON_THRESHOLDS) {
    if (balance < tier.points) continue;
    const already = coupons.values().some(c => c.userId === userId && c.tierCode === tier.code);
    if (already) continue;
    const code = `${tier.code}-${uuid().slice(0, 6).toUpperCase()}`;
    coupons.set(code, { userId, tierCode: tier.code, label: tier.label, redeemed: false, issuedAt: Date.now() });
    issued.push({ code, label: tier.label });
  }
  return issued;
}

export function redeemCoupon(code, userId) {
  const c = coupons.get(code);
  if (!c) return { ok: false, error: 'كوبون غير موجود' };
  if (c.userId !== userId) return { ok: false, error: 'الكوبون ده مش بتاعك' };
  if (c.redeemed) return { ok: false, error: 'الكوبون ده اتستخدم قبل كده' };
  coupons.set(code, { ...c, redeemed: true, redeemedAt: Date.now() });
  return { ok: true, label: c.label };
}

export function listCoupons(userId) {
  return coupons
    .entries()
    .filter(([, c]) => c.userId === userId)
    .map(([code, c]) => ({ code, label: c.label, redeemed: c.redeemed }));
}

/**
 * مكافآت نهاية اللعبة — مركزية عشان كل الألعاب تستخدم نفس الأرقام.
 * الضيوف (guest_*) مبياخدوش نقاط: النقاط ليها قيمة (كوبونات) فلازم حساب حقيقي.
 */
export const GAME_REWARDS = { win: 50, participation: 5 };

export function isRewardable(userId) {
  return typeof userId === 'string' && !userId.startsWith('guest_');
}

export function awardGameResult(gameType, players, winnerUserId) {
  const awards = [];
  for (const p of players) {
    if (!isRewardable(p.userId)) continue;
    const delta = p.userId === winnerUserId ? GAME_REWARDS.win : GAME_REWARDS.participation;
    const balance = addPoints(p.userId, delta, `${gameType}:${p.userId === winnerUserId ? 'win' : 'played'}`);
    awards.push({ userId: p.userId, delta, balance, newCoupons: checkAndIssueCoupons(p.userId) });
  }
  return awards;
}

export default {
  getBalance,
  addPoints,
  getHistory,
  checkAndIssueCoupons,
  redeemCoupon,
  listCoupons,
  awardGameResult,
  GAME_REWARDS
};
