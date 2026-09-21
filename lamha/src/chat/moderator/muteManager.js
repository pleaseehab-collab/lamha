import { env } from '../../config/env.js';

/**
 * نظام "الكتم المؤقت" — كل مخالفة بتزوّد عداد الـ strikes بتاع المستخدم،
 * ومدة الكتم بتزيد كل مرة (escalation) بدل ما تبقى مدة ثابتة، عشان المخالف
 * المتكرر ياخد عقوبة أقسى تدريجياً من غير ما نحتاج تدخل بشري في الحالات
 * البسيطة.
 *
 * ⚠️ في الذاكرة فقط (Phase 1) — للإنتاج انقلها لـ Redis/DB عشان تفضل
 * محفوظة بعد الـ restart وتشتغل صح مع أكتر من سيرفر.
 */

const state = new Map(); // userId -> { strikes, muteUntil }
const BASE_SECONDS = env.chat.muteDefaultSeconds;

// تصاعد مدة الكتم حسب عدد المخالفات: 1=قاعدة، 2=×3، 3=×8، 4+=×20 (دقايق طويلة)
const ESCALATION_MULTIPLIER = [1, 3, 8, 20];

function multiplierFor(strikeCount) {
  const idx = Math.min(strikeCount, ESCALATION_MULTIPLIER.length) - 1;
  return ESCALATION_MULTIPLIER[Math.max(idx, 0)];
}

export function isMuted(userId) {
  const s = state.get(userId);
  if (!s || !s.muteUntil) return false;
  return Date.now() < s.muteUntil;
}

export function muteRemainingSeconds(userId) {
  const s = state.get(userId);
  if (!s || !s.muteUntil) return 0;
  return Math.max(0, Math.ceil((s.muteUntil - Date.now()) / 1000));
}

/**
 * يسجّل مخالفة جديدة ويطبّق كتم مؤقت متصاعد.
 * @param {string} userId
 * @param {{ severityOverrideSeconds?: number }} opts لو المشرف عايز يفرض مدة مباشرة (مخالفة شديدة)
 */
export function strikeAndMute(userId, opts = {}) {
  const s = state.get(userId) || { strikes: 0, muteUntil: 0 };
  s.strikes += 1;
  const seconds = opts.severityOverrideSeconds ?? BASE_SECONDS * multiplierFor(s.strikes);
  s.muteUntil = Date.now() + seconds * 1000;
  state.set(userId, s);
  return { strikes: s.strikes, muteSeconds: seconds, muteUntil: s.muteUntil };
}

export function getStrikes(userId) {
  return state.get(userId)?.strikes || 0;
}

/** يشيل الكتم يدوياً (لو مشرف بشري تدخّل) */
export function unmute(userId) {
  const s = state.get(userId);
  if (s) s.muteUntil = 0;
}

/** يصفّر السجل بالكامل (استخدام إداري نادر) */
export function resetUser(userId) {
  state.delete(userId);
}

export default { isMuted, muteRemainingSeconds, strikeAndMute, getStrikes, unmute, resetUser };
