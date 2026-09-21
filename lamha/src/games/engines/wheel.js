import { randomInt } from 'node:crypto';
import { addPoints, checkAndIssueCoupons } from '../pointsSystem.js';
import { collection } from '../../db/index.js';

/**
 * عجلة الحظ — أول لعبة شغّالة بالكامل من نظام الألعاب الجماعية، ولعبة فردية
 * (مش محتاجة Lobby أو لاعبين تانيين) بعكس الليدو/الدومينو/أونو.
 */

// وزن كل جائزة بيحدد احتمالية ظهورها. مجموع الأوزان مش لازم يساوي 100،
// بنطبّعه (normalize) تلقائي وقت الحساب.
const PRIZES = [
  { id: 'p10', label: '10 نقاط', points: 10, weight: 35 },
  { id: 'p25', label: '25 نقطة', points: 25, weight: 25 },
  { id: 'p50', label: '50 نقطة', points: 50, weight: 15 },
  { id: 'p100', label: '100 نقطة', points: 100, weight: 10 },
  { id: 'try_again', label: 'حظ أوفر المرة الجاية', points: 0, weight: 10 },
  { id: 'jackpot', label: '🎉 500 نقطة (جاكبوت)', points: 500, weight: 5 }
];

const SPIN_COOLDOWN_MS = 24 * 60 * 60 * 1000; // مرة كل 24 ساعة لكل مستخدم
const lastSpin = collection('wheel_last_spin'); // userId -> timestamp (محفوظ عبر الـ facade فمفيش لف مجاني بعد restart)

function pickPrize() {
  const totalWeight = PRIZES.reduce((sum, p) => sum + p.weight, 0);
  let roll = randomInt(0, totalWeight * 1000) / 1000; // crypto RNG بدل Math.random
  for (const prize of PRIZES) {
    if (roll < prize.weight) return prize;
    roll -= prize.weight;
  }
  return PRIZES[0];
}

export function canSpin(userId) {
  const last = lastSpin.get(userId) || 0;
  const remaining = SPIN_COOLDOWN_MS - (Date.now() - last);
  return { allowed: remaining <= 0, remainingMs: Math.max(0, remaining) };
}

export function spin(userId) {
  const check = canSpin(userId);
  if (!check.allowed) {
    return { ok: false, error: 'استنى لحد الدورة الجاية بكرة', remainingMs: check.remainingMs };
  }

  const prize = pickPrize();
  lastSpin.set(userId, Date.now());

  let balance = null;
  if (prize.points > 0) balance = addPoints(userId, prize.points, `wheel:${prize.id}`);
  const newCoupons = prize.points > 0 ? checkAndIssueCoupons(userId) : [];

  return { ok: true, prize, balance, newCoupons };
}

export function prizeList() {
  return PRIZES.map(({ id, label, weight }) => ({ id, label, weight }));
}

export default { spin, canSpin, prizeList };
