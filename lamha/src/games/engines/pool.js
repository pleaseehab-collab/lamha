/**
 * 8-Ball Pool — محرك server-authoritative بالكامل.
 *
 * العميل بيبعت "نيّة" بس:
 *   { type: 'place_cue', x, y }        → لما يكون عنده ball-in-hand (اختياري)
 *   { type: 'shoot', angle, power }    → angle بالراديان، power من 0 لـ 1
 * والسيرفر بيشغّل الفيزياء كلها (تصادمات، جوانب، جيوب) ويطبّق القواعد ويرجّع:
 *   - state جديد (مواقع الكور النهائية + الدور + المجموعات)
 *   - event 'shot_result' فيه frames للأنيميشن (20fps) عشان العميل يعرضها بس.
 *
 * التمثيل: كور 0=البيضا، 1-7 مصمتة، 8=السودا، 9-15 مخططة.
 * الطاولة: عرض 2000 × ارتفاع 1000، قطر الكورة 50. الجيوب 6 (4 أركان + 2 جنب).
 *
 * القواعد المطبّقة (نسخة "بار" بدون تسمية جيب — no called pocket):
 *  - الطاولة مفتوحة لحد أول ضربة قانونية بعد الكسر بتحط كورة/كور من نوع واحد.
 *  - الفاول: كورة بيضا اتحطت في جيب، مالمستش أي كورة، لمست الكورة الغلط
 *    الأول، ولا كورة لمست جانب بعد الاحتكاك (ومفيش كورة اتحطت)، أو كسر غير قانوني
 *    (أقل من 4 كور وصلت للجوانب/الجيوب ومفيش كورة اتحطت).
 *  - بعد الفاول: الخصم بياخد ball-in-hand في أي مكان.
 *  - السودا: لو اتحطت قبل تخلّص مجموعتك، أو مع فاول → خسارة. لو اتحطت بعد ما
 *    تخلّص مجموعتك وبدون فاول → فوز. لو اتحطت في الكسر → re-rack.
 */

import { randomInt } from 'node:crypto';

export const meta = {
  id: 'pool',
  name: 'بلياردو 8-Ball',
  minPlayers: 2,
  maxPlayers: 2
};

// ---------- ثوابت الطاولة والفيزياء ----------
export const TABLE = { width: 2000, height: 1000, ballRadius: 25 };
const W = TABLE.width;
const H = TABLE.height;
const R = TABLE.ballRadius;
const HEAD_STRING_X = W / 4;
const FOOT_SPOT = { x: W * 0.75, y: H / 2 };
const HEAD_SPOT = { x: W * 0.25, y: H / 2 };

const POCKETS = [
  { x: 0, y: 0, r: 58 },
  { x: W, y: 0, r: 58 },
  { x: 0, y: H, r: 58 },
  { x: W, y: H, r: 58 },
  { x: W / 2, y: 0, r: 50 },
  { x: W / 2, y: H, r: 50 }
];

const DT = 1 / 240;
const MAX_STEPS = 240 * 45;
const MAX_SPEED = 2400; // وحدة/ثانية عند power=1
const DECEL = 300; // احتكاك الطاولة
const STOP_SPEED = 4;
const BALL_RESTITUTION = 0.96;
const RAIL_RESTITUTION = 0.78;
const FRAME_EVERY = 12; // 240/12 = 20 فريم/ثانية
const MIN_POWER = 0.02;

export const groupOf = id => (id === 8 ? 'eight' : id >= 1 && id <= 7 ? 'solids' : id >= 9 ? 'stripes' : null);
const otherGroup = g => (g === 'solids' ? 'stripes' : 'solids');

// ---------- الرص (rack) ----------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildRack() {
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const slots = new Array(15).fill(null);
  slots[4] = 8; // السودا في النص (تالت صف)
  const cornerFlip = randomInt(0, 2) === 0;
  slots[10] = cornerFlip ? solids.pop() : stripes.pop(); // ركني الصف الأخير: واحدة من كل نوع
  slots[14] = cornerFlip ? stripes.pop() : solids.pop();
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (slots[i] === null) slots[i] = rest.pop();

  const rowGap = Math.sqrt(3) * R + 0.2;
  const balls = [];
  let k = 0;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      balls.push({
        id: slots[k++],
        x: FOOT_SPOT.x + row * rowGap,
        y: FOOT_SPOT.y + (i - row / 2) * (2 * R + 0.2),
        potted: false
      });
    }
  }
  return balls;
}

function freshBalls() {
  const cue = { id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, potted: false };
  return [cue, ...buildRack()].sort((a, b) => a.id - b.id);
}

// ---------- التحقق من موضع الكورة البيضا ----------
function isValidCuePosition(balls, x, y, zone) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < R || x > W - R || y < R || y > H - R) return false;
  if (zone === 'kitchen' && x > HEAD_STRING_X) return false;
  for (const b of balls) {
    if (b.id === 0 || b.potted) continue;
    if (Math.hypot(b.x - x, b.y - y) < 2 * R + 0.5) return false;
  }
  for (const p of POCKETS) if (Math.hypot(p.x - x, p.y - y) < p.r + 2) return false;
  return true;
}

function findFreeSpot(balls, zone, prefer = HEAD_SPOT) {
  if (isValidCuePosition(balls, prefer.x, prefer.y, zone)) return { x: prefer.x, y: prefer.y };
  for (let ring = 1; ring <= 40; ring++) {
    const step = ring * R;
    for (let a = 0; a < 360; a += 15) {
      const x = prefer.x + Math.cos((a * Math.PI) / 180) * step;
      const y = prefer.y + Math.sin((a * Math.PI) / 180) * step;
      if (isValidCuePosition(balls, x, y, zone)) return { x, y };
    }
  }
  return { x: HEAD_SPOT.x, y: HEAD_SPOT.y }; // مفروض مستحيل يحصل
}

// ---------- الفيزياء ----------
/**
 * بيشغّل ضربة كاملة لحد ما كل الكور توقف.
 * @returns {{ balls, firstContact, potted, railAfterContact, railBalls, frames }}
 */
export function simulateShot(ballsIn, angle, power) {
  const balls = ballsIn.map(b => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, potted: b.potted }));
  const cue = balls[0];
  const speed = MAX_SPEED * power;
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;

  let firstContact = null;
  let railAfterContact = false;
  const railBalls = new Set();
  const potted = [];
  const frames = [];

  const snapshot = () => {
    const f = new Array(32);
    for (const b of balls) {
      f[b.id * 2] = b.potted ? -1 : Math.round(b.x * 10) / 10;
      f[b.id * 2 + 1] = b.potted ? -1 : Math.round(b.y * 10) / 10;
    }
    return f;
  };
  frames.push(snapshot());

  for (let step = 1; step <= MAX_STEPS; step++) {
    let moving = false;

    for (const b of balls) {
      if (b.potted) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const ns = sp - DECEL * DT;
        if (ns <= STOP_SPEED) {
          b.vx = 0;
          b.vy = 0;
        } else {
          b.vx *= ns / sp;
          b.vy *= ns / sp;
          moving = true;
        }
      }
      b.x += b.vx * DT;
      b.y += b.vy * DT;

      // جيوب
      for (const p of POCKETS) {
        if (Math.hypot(b.x - p.x, b.y - p.y) < p.r) {
          b.potted = true;
          b.vx = b.vy = 0;
          potted.push(b.id);
          break;
        }
      }
      if (b.potted) continue;

      // جوانب الطاولة
      let hitRail = false;
      if (b.x < R) { b.x = R; if (b.vx < 0) b.vx = -b.vx * RAIL_RESTITUTION; hitRail = true; }
      else if (b.x > W - R) { b.x = W - R; if (b.vx > 0) b.vx = -b.vx * RAIL_RESTITUTION; hitRail = true; }
      if (b.y < R) { b.y = R; if (b.vy < 0) b.vy = -b.vy * RAIL_RESTITUTION; hitRail = true; }
      else if (b.y > H - R) { b.y = H - R; if (b.vy > 0) b.vy = -b.vy * RAIL_RESTITUTION; hitRail = true; }
      if (hitRail) {
        if (b.id !== 0) railBalls.add(b.id);
        if (firstContact !== null) railAfterContact = true;
      }
    }

    // تصادم كور
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.potted) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j];
        if (c.potted) continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const overlap = (2 * R - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        c.x += nx * overlap; c.y += ny * overlap;
        const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (vn > 0) {
          const imp = (vn * (1 + BALL_RESTITUTION)) / 2;
          a.vx -= imp * nx; a.vy -= imp * ny;
          c.vx += imp * nx; c.vy += imp * ny;
          moving = true;
          if (firstContact === null && (a.id === 0 || c.id === 0)) firstContact = a.id === 0 ? c.id : a.id;
        }
      }
    }

    if (step % FRAME_EVERY === 0) frames.push(snapshot());
    if (!moving && !balls.some(b => !b.potted && (b.vx || b.vy))) break;
  }

  for (const b of balls) { b.vx = 0; b.vy = 0; }
  frames.push(snapshot());
  return { balls, firstContact, potted, railAfterContact, railBalls, frames };
}

// ---------- الحالة ----------
export function createInitialState(players) {
  const balls = freshBalls();
  return {
    gameId: meta.id,
    status: 'in_progress',
    turnIndex: 0,
    table: { ...TABLE, pockets: POCKETS, headStringX: HEAD_STRING_X },
    players: players.slice(0, 2).map(p => ({ userId: p.userId, username: p.username, group: null })),
    balls,
    pottedOrder: [],
    breakShot: true,
    ballInHand: true,
    ballInHandZone: 'kitchen',
    shotCount: 0,
    lastShot: null,
    winner: null,
    loseReason: null
  };
}

export function currentPlayer(state) {
  return state.players[state.turnIndex];
}

/** الهدف الحالي للاعب: 'open' | 'solids' | 'stripes' | 'eight' */
export function targetFor(state, player) {
  if (!player.group) return 'open';
  const remaining = state.balls.some(b => !b.potted && groupOf(b.id) === player.group);
  return remaining ? player.group : 'eight';
}

const opponentOf = (state, userId) => state.players.find(p => p.userId !== userId);

function rerack(state, breakerIndex) {
  state.balls = freshBalls();
  state.pottedOrder = [];
  state.breakShot = true;
  state.ballInHand = true;
  state.ballInHandZone = 'kitchen';
  state.turnIndex = breakerIndex;
  state.players.forEach(p => (p.group = null));
}

function endGame(state, winnerUserId, reason) {
  state.status = 'finished';
  state.winner = winnerUserId;
  state.loseReason = reason;
  state.ballInHand = false;
}

function handlePlaceCue(state, userId, move) {
  if (!state.ballInHand) return { state, events: [], error: 'مفيش ball-in-hand دلوقتي' };
  const x = Number(move.x);
  const y = Number(move.y);
  if (!isValidCuePosition(state.balls, x, y, state.ballInHandZone)) {
    return { state, events: [], error: 'مكان الكورة البيضا غير صالح' };
  }
  state.balls[0].x = x;
  state.balls[0].y = y;
  state.balls[0].potted = false;
  return { state, events: [{ type: 'cue_placed', userId, x, y }] };
}

function handleShoot(state, userId, move) {
  const angle = Number(move.angle);
  let power = Number(move.power);
  if (!Number.isFinite(angle) || !Number.isFinite(power)) return { state, events: [], error: 'ضربة غير صحيحة' };
  power = Math.min(1, Math.max(MIN_POWER, power));

  const player = currentPlayer(state);
  const opp = opponentOf(state, userId);

  // لو ball-in-hand والكورة البيضا واقفة في مكان مش صالح، نلاقيلها مكان
  if (state.ballInHand) {
    const cue = state.balls[0];
    cue.potted = false;
    if (!isValidCuePosition(state.balls, cue.x, cue.y, state.ballInHandZone)) {
      const spot = findFreeSpot(state.balls, state.ballInHandZone, { x: cue.x, y: cue.y });
      cue.x = spot.x;
      cue.y = spot.y;
    }
  }

  const targetBefore = targetFor(state, player);
  const wasBreak = state.breakShot;
  const sim = simulateShot(state.balls, angle, power);

  // تطبيق النتيجة النهائية على الحالة
  state.balls = sim.balls.map(b => ({ id: b.id, x: b.x, y: b.y, potted: b.potted }));
  state.shotCount += 1;
  state.ballInHand = false;
  state.breakShot = false;

  const cuePotted = sim.potted.includes(0);
  const objectPotted = sim.potted.filter(id => id !== 0);
  state.pottedOrder.push(...objectPotted);

  const fouls = [];
  if (cuePotted) fouls.push('scratch');
  if (sim.firstContact === null) fouls.push('no_contact');
  else {
    // القاعدة بتتقيّم على الهدف "قبل" الضربة (targetBefore)
    const g = groupOf(sim.firstContact);
    const wrong = targetBefore === 'open' ? g === 'eight' : g !== targetBefore;
    if (wrong) fouls.push('wrong_first_contact');
  }
  if (sim.firstContact !== null && objectPotted.length === 0 && !sim.railAfterContact && !cuePotted) fouls.push('no_rail');
  if (wasBreak) {
    const reached = new Set([...sim.railBalls, ...objectPotted]);
    if (reached.size < 4 && !objectPotted.includes(8)) fouls.push('illegal_break');
  }

  const events = [];
  const shotEvent = {
    type: 'shot_result',
    userId,
    angle,
    power,
    frameRate: 20,
    frames: sim.frames,
    potted: sim.potted,
    firstContact: sim.firstContact,
    fouls
  };
  events.push(shotEvent);
  state.lastShot = { userId, potted: sim.potted, firstContact: sim.firstContact, fouls };

  // --- السودا ---
  if (objectPotted.includes(8)) {
    if (wasBreak) {
      const nextBreaker = cuePotted ? state.players.findIndex(p => p.userId === opp.userId) : state.turnIndex;
      rerack(state, nextBreaker);
      events.push({ type: 'rerack', reason: 'eight_on_break', breaker: state.players[state.turnIndex].userId });
      return { state, events };
    }
    const clearedBefore = targetBefore === 'eight';
    if (!clearedBefore || fouls.length > 0) {
      endGame(state, opp.userId, !clearedBefore ? 'eight_potted_early' : 'eight_potted_with_foul');
    } else {
      endGame(state, userId, 'eight_potted_legally');
    }
    events.push({ type: 'game_finished', winner: state.winner, reason: state.loseReason });
    return { state, events };
  }

  // --- تحديد المجموعات (طاولة مفتوحة، مش كسر، مفيش فاول) ---
  if (!wasBreak && fouls.length === 0 && !player.group) {
    const groups = new Set(objectPotted.map(groupOf));
    if (groups.size === 1) {
      const g = [...groups][0];
      player.group = g;
      opp.group = otherGroup(g);
      events.push({ type: 'groups_assigned', [player.userId]: g, [opp.userId]: opp.group });
    }
  }

  // --- الدور ---
  if (fouls.length > 0) {
    state.turnIndex = state.players.findIndex(p => p.userId === opp.userId);
    state.ballInHand = true;
    state.ballInHandZone = 'any';
    const cue = state.balls[0];
    cue.potted = false;
    if (cuePotted || !isValidCuePosition(state.balls, cue.x, cue.y, 'any')) {
      const spot = findFreeSpot(state.balls, 'any', cuePotted ? HEAD_SPOT : { x: cue.x, y: cue.y });
      cue.x = spot.x;
      cue.y = spot.y;
    }
    events.push({ type: 'foul', userId, reasons: fouls, nextPlayer: opp.userId });
  } else {
    const keeps = player.group
      ? objectPotted.some(id => groupOf(id) === player.group)
      : objectPotted.length > 0;
    if (!keeps) {
      state.turnIndex = state.players.findIndex(p => p.userId === opp.userId);
      events.push({ type: 'turn_changed', userId: opp.userId });
    } else {
      events.push({ type: 'extra_turn', userId });
    }
  }

  return { state, events };
}

/**
 * @param {object} state
 * @param {string} userId
 * @param {{type: 'shoot'|'place_cue', angle?: number, power?: number, x?: number, y?: number}} move
 */
export function applyMove(state, userId, move) {
  if (state.status !== 'in_progress') return { state, events: [], error: 'اللعبة خلصت' };
  if (currentPlayer(state).userId !== userId) return { state, events: [], error: 'مش دورك' };
  if (move?.type === 'place_cue') return handlePlaceCue(state, userId, move);
  if (move?.type === 'shoot') return handleShoot(state, userId, move);
  return { state, events: [], error: 'حركة غير مدعومة' };
}

export default { meta, createInitialState, applyMove, currentPlayer };
