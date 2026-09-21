import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { logger } from '../utils/logger.js';
import { collection } from '../db/index.js';

/**
 * مخزن المستخدمين — بيستخدم database facade (src/db) بدل ملف JSON خاص.
 * الواجهة (exports) متغيّرتش، فالراوتس والـ middleware شغّالين زي ما هما.
 * ترحيل تلقائي: لو لسه فيه data/users.json قديم والـ collection فاضية،
 * بيتستورد مرة واحدة.
 */

const users = collection('users'); // id -> user
const LEGACY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'users.json');

if (users.size === 0) {
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    for (const u of legacy.users || []) users.set(u.id, u);
    if (users.size) logger.info('تم ترحيل المستخدمين من users.json للـ database facade', { count: users.size });
  } catch {
    /* مفيش ملف قديم — عادي */
  }
}

const allUsers = () => users.values();

function genReferralCode() {
  return uuid().split('-')[0].toUpperCase();
}

export function findByEmail(email) {
  if (!email) return null;
  return allUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

export function findById(id) {
  return (id && users.get(id)) || null;
}

export function findByReferralCode(code) {
  if (!code) return null;
  return allUsers().find(u => u.referralCode === code) || null;
}

export function createUser({ email, password, role = 'user', referredByCode = null }) {
  if (findByEmail(email)) {
    return { ok: false, error: 'الإيميل ده مسجّل قبل كده.' };
  }
  const referrer = referredByCode ? findByReferralCode(referredByCode) : null;
  const user = {
    id: uuid(),
    email: email.toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    referralCode: genReferralCode(),
    referredBy: referrer ? referrer.id : null,
    wallet: { balance: 0, currency: 'EGP' },
    merchant: role === 'merchant' ? { package: null, subscribedAt: null } : null,
    createdAt: new Date().toISOString()
  };
  users.set(user.id, user);
  logger.info('مستخدم جديد اتسجّل', { id: user.id, role: user.role });
  return { ok: true, user };
}

export function verifyLogin(email, password) {
  const user = findByEmail(email);
  if (!user) return { ok: false, error: 'بيانات الدخول غلط.' };
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, error: 'بيانات الدخول غلط.' };
  return { ok: true, user };
}

export function creditWallet(userId, amount, reason = 'credit') {
  const user = findById(userId);
  if (!user) return null;
  user.wallet.balance = Number((user.wallet.balance + amount).toFixed(2));
  users.set(user.id, user);
  logger.info('تعديل رصيد محفظة', { userId, amount, reason, newBalance: user.wallet.balance });
  return user.wallet;
}

export function getWallet(userId) {
  const user = findById(userId);
  return user ? user.wallet : null;
}

export function setMerchantPackage(userId, packageId) {
  const user = findById(userId);
  if (!user) return null;
  user.role = 'merchant';
  user.merchant = { package: packageId, subscribedAt: new Date().toISOString() };
  users.set(user.id, user);
  return user.merchant;
}

/** يرجّع نسخة آمنة من اليوزر من غير passwordHash — للاستخدام في الردود/التوكنات */
export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export default {
  findByEmail, findById, findByReferralCode, createUser, verifyLogin,
  creditWallet, getWallet, setMerchantPackage, publicUser
};
