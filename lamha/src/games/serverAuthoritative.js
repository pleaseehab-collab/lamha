/**
 * أدوات "Server-Authoritative" مشتركة لكل الألعاب (ليدو، دومينو، أونو،
 * عجلة الحظ) — الهدف: أي قيمة ليها تأثير على الفوز/الجوائز/الحركة لازم
 * تتحسب في السيرفر فقط، والعميل يبعت "نيّة" (intent) مش "نتيجة".
 *
 * الثغرة اللي كانت موجودة فعلياً في النسخة الأصلية: socket.handshake.auth.userId
 * كان بيتاخد زي ما هو من العميل من غير أي تحقق — يعني أي حد يقدر يفتح
 * اتصال ويدّعي إنه userId أي حد تاني، ويسرق نقاطه أو يلعب بدل حد تاني.
 * دلوقتي بعد ربط socketAuth.js، الـ userId بييجي من JWT موقّع بالسيرفر،
 * مش من الـ handshake.
 */

import { logger } from '../utils/logger.js';

const ACTION_WINDOW_MS = 1000;
const MAX_ACTIONS_PER_WINDOW = 5; // كفاية للعب طبيعي، بيمنع سكريبتات بتضرب حركات بسرعة غير بشرية

/**
 * Rate limiter لكل سوكت (مش لكل IP) — يمنع فيضان أحداث اللعبة من بوت.
 *
 * ⚠️ تصحيح تسريب ذاكرة (memory leak): النسخة الأصلية كانت بتضيف socket.id
 * جديد في الـ Map مع كل اتصال ومتشيلوش أبداً حتى بعد الـ disconnect —
 * فمع آلاف الاتصالات على مدار الوقت، الـ Map كانت هتكبر من غير حد أقصى
 * لحد ما تاكل الذاكرة. دلوقتي بنرجّع `release(socket)` كمان عشان
 * gamesSocket.js ينضّف بيها على disconnect.
 */
export function createSocketActionLimiter() {
  const log = new Map(); // socketId -> timestamps[]
  function limit(socket) {
    const now = Date.now();
    const arr = (log.get(socket.id) || []).filter(t => now - t < ACTION_WINDOW_MS);
    arr.push(now);
    log.set(socket.id, arr);
    if (arr.length > MAX_ACTIONS_PER_WINDOW) {
      logger.warn('سرعة أحداث لعبة مشبوهة من سوكت واحد', { socketId: socket.id, userId: socket.data?.userId });
      return false;
    }
    return true;
  }
  function release(socket) {
    log.delete(socket.id);
  }
  limit.release = release;
  return limit;
}

/**
 * بيشيل أي فيلد بيحاول العميل يبعته زي إنه "نتيجة" (roll, result, outcome,
 * winner, prize, score) — القيم دي لازم تتحسب في السيرفر بس، مش تتاخد
 * زي ما هي من رسالة العميل.
 */
const FORBIDDEN_CLIENT_FIELDS = ['roll', 'result', 'outcome', 'winner', 'prize', 'score', 'diceValue'];

export function sanitizeClientPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const clean = { ...payload };
  for (const field of FORBIDDEN_CLIENT_FIELDS) delete clean[field];
  return clean;
}

/**
 * لازم يتأكد إن اللي بعت الحركة هو فعلاً صاحب الدور الحالي جوه حالة اللعبة.
 *
 * ⚠️ تصحيح: النسخة القديمة كانت بتدوّر على gameState.currentTurnUserId
 * اللي مش موجود أصلاً في شكل الـ state بتاع أي محرك من محركاتنا (ludo/
 * domino/uno بيستخدموا turnIndex + دالة currentPlayer(state))، فالدالة
 * كانت *ميت كود* عمليًا: متعرّفة لكن مبتتنادَاش من أي مكان، ولو اتنادت
 * كانت هترجّع true دايمًا بالغلط (لأن currentTurnUserId هيبقى undefined
 * وبالتالي الشرط الأول بيرجّع true فورًا) — يعني كانت وهم حماية مش
 * حماية فعلية. دلوقتي بتاخد المحرك نفسه وتستخدم currentPlayer(state)
 * بتاعه، وهي المستخدمة فعليًا في lobbyManager.applyMove كطبقة دفاع
 * إضافية قبل ما الحركة توصل لمنطق المحرك.
 */
export function assertPlayerTurn(engine, gameState, userId) {
  if (!engine || typeof engine.currentPlayer !== 'function') return true; // محرك مفيهوش مفهوم "دور" (زي العجلة)
  const current = engine.currentPlayer(gameState);
  if (!current) return true; // اللعبة لسه مبدأتش
  return current.userId === userId;
}

export default { createSocketActionLimiter, sanitizeClientPayload, assertPlayerTurn };
