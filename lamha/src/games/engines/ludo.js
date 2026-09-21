/**
 * الليدو — محرك كامل server-authoritative.
 *
 * التمثيل:
 *  - كل مهرة ليها موضع نسبي `rel` بالنسبة للون صاحبها:
 *      -1        = في البيت (base)
 *      0..50     = على الحلقة المشتركة (51 مربع)، 0 هو مربع البداية بتاع اللون
 *      51..55    = طريق البيت الخاص (home column) — آمن تماماً
 *      56        = وصلت النهاية (finished)
 *  - الحلقة المشتركة 52 مربع؛ المربع المطلق abs = (START[color] + rel) % 52.
 *  - المربعات الآمنة: مربعات البداية الأربعة + النجوم (8, 21, 34, 47).
 *
 * القواعد:
 *  - محتاج 6 عشان تطلّع مهرة من البيت.
 *  - 6 = دور إضافي (3 سكستات ورا بعض = ضياع الدور).
 *  - أكل مهرة خصم على مربع غير آمن = ترجّعها البيت + دور إضافي.
 *  - الوصول للنهاية بيحتاج رقم مظبوط (مينفعش تعدّي 56) + دور إضافي.
 *  - أول لاعب يوصّل 4 مهرات للنهاية بيكسب.
 *
 * النرد بيتحسب هنا بس (crypto-grade) — العميل بيبعت نيّة `roll_dice`
 * و`move_piece {pieceIndex}` بس.
 */

import { randomInt } from 'node:crypto';

export const meta = {
  id: 'ludo',
  name: 'الليدو',
  minPlayers: 2,
  maxPlayers: 4
};

export const RING_SIZE = 52;
export const LAST_RING_REL = 50;
export const FINISH_REL = 56;
const START = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_ABS = new Set([0, 13, 26, 39, 8, 21, 34, 47]);
const MAX_CONSECUTIVE_SIXES = 3;

function colorsFor(count) {
  if (count === 2) return ['red', 'yellow'];
  if (count === 3) return ['red', 'green', 'yellow'];
  return ['red', 'green', 'yellow', 'blue'];
}

export function absPosition(color, rel) {
  if (rel < 0 || rel > LAST_RING_REL) return null; // مش على الحلقة المشتركة
  return (START[color] + rel) % RING_SIZE;
}

export function createInitialState(players) {
  const colors = colorsFor(players.length);
  return {
    gameId: meta.id,
    status: 'in_progress',
    turnIndex: 0,
    players: players.map((p, i) => ({
      userId: p.userId,
      username: p.username,
      color: colors[i],
      pieces: [-1, -1, -1, -1]
    })),
    phase: 'roll', // 'roll' -> 'move'
    dice: null,
    legalMoves: [],
    consecutiveSixes: 0,
    lastDiceRoll: null,
    winner: null
  };
}

export function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function nextTurn(state) {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
  state.phase = 'roll';
  state.dice = null;
  state.legalMoves = [];
  state.consecutiveSixes = 0;
}

function grantExtraRoll(state) {
  state.phase = 'roll';
  state.dice = null;
  state.legalMoves = [];
}

/** الحركات القانونية للاعب بالقيمة الحالية → [{ pieceIndex, from, to }] */
export function computeLegalMoves(player, value) {
  const moves = [];
  player.pieces.forEach((rel, pieceIndex) => {
    if (rel === FINISH_REL) return;
    if (rel === -1) {
      if (value === 6) moves.push({ pieceIndex, from: -1, to: 0 });
      return;
    }
    const to = rel + value;
    if (to <= FINISH_REL) moves.push({ pieceIndex, from: rel, to });
  });
  return moves;
}

function captureAt(state, mover, toRel) {
  const abs = absPosition(mover.color, toRel);
  if (abs === null || SAFE_ABS.has(abs)) return [];
  const captured = [];
  for (const opp of state.players) {
    if (opp.userId === mover.userId) continue;
    opp.pieces.forEach((rel, pieceIndex) => {
      if (absPosition(opp.color, rel) === abs) {
        opp.pieces[pieceIndex] = -1;
        captured.push({ userId: opp.userId, pieceIndex });
      }
    });
  }
  return captured;
}

function performMove(state, player, move) {
  const events = [];
  player.pieces[move.pieceIndex] = move.to;
  events.push({ type: 'piece_moved', userId: player.userId, pieceIndex: move.pieceIndex, from: move.from, to: move.to });

  const captured = captureAt(state, player, move.to);
  for (const c of captured) events.push({ type: 'piece_captured', by: player.userId, ...c });

  const finishedNow = move.to === FINISH_REL;
  if (finishedNow) events.push({ type: 'piece_finished', userId: player.userId, pieceIndex: move.pieceIndex });

  if (player.pieces.every(r => r === FINISH_REL)) {
    state.status = 'finished';
    state.winner = player.userId;
    state.phase = 'done';
    state.dice = null;
    state.legalMoves = [];
    events.push({ type: 'game_finished', winner: player.userId });
    return events;
  }

  const extra = state.dice === 6 || captured.length > 0 || finishedNow;
  if (extra) {
    grantExtraRoll(state);
    events.push({ type: 'extra_turn', userId: player.userId });
  } else {
    nextTurn(state);
    events.push({ type: 'turn_changed', userId: currentPlayer(state).userId });
  }
  return events;
}

/**
 * @param {object} state
 * @param {string} userId
 * @param {{type: 'roll_dice'|'move_piece', pieceIndex?: number}} move
 */
export function applyMove(state, userId, move) {
  if (state.status !== 'in_progress') return { state, events: [], error: 'اللعبة خلصت' };
  const player = currentPlayer(state);
  if (player.userId !== userId) return { state, events: [], error: 'مش دورك' };

  if (move?.type === 'roll_dice') {
    if (state.phase !== 'roll') return { state, events: [], error: 'اختار مهرة تحركها الأول' };
    const value = randomInt(1, 7);
    state.lastDiceRoll = { userId, value };
    const events = [{ type: 'dice_rolled', userId, value }];

    if (value === 6) state.consecutiveSixes += 1;
    else state.consecutiveSixes = 0;

    if (state.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
      events.push({ type: 'three_sixes_forfeit', userId });
      nextTurn(state);
      events.push({ type: 'turn_changed', userId: currentPlayer(state).userId });
      return { state, events };
    }

    state.dice = value;
    const legal = computeLegalMoves(player, value);
    if (legal.length === 0) {
      events.push({ type: 'no_legal_moves', userId });
      if (value === 6) {
        grantExtraRoll(state);
        events.push({ type: 'extra_turn', userId });
      } else {
        nextTurn(state);
        events.push({ type: 'turn_changed', userId: currentPlayer(state).userId });
      }
      return { state, events };
    }

    if (legal.length === 1) {
      // حركة وحيدة → بننفذها أوتوماتيك (مفيش اختيار حقيقي يتعمل)
      events.push(...performMove(state, player, legal[0]));
      return { state, events };
    }

    state.phase = 'move';
    state.legalMoves = legal.map(m => m.pieceIndex);
    return { state, events };
  }

  if (move?.type === 'move_piece') {
    if (state.phase !== 'move') return { state, events: [], error: 'ارمي النرد الأول' };
    const idx = Number(move.pieceIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { state, events: [], error: 'رقم مهرة غير صحيح' };
    const chosen = computeLegalMoves(player, state.dice).find(m => m.pieceIndex === idx);
    if (!chosen) return { state, events: [], error: 'المهرة دي مينفعش تتحرك بالرقم ده' };
    return { state, events: performMove(state, player, chosen) };
  }

  return { state, events: [], error: 'حركة غير مدعومة' };
}

export default { meta, createInitialState, applyMove, currentPlayer };
