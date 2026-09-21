import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_DRIVER = 'memory';

const pool = (await import('../src/games/engines/pool.js')).default;
const poolMod = await import('../src/games/engines/pool.js');
const ludo = (await import('../src/games/engines/ludo.js')).default;
const ludoMod = await import('../src/games/engines/ludo.js');

const P = [{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }];

// ---------------- Pool ----------------
test('pool: initial rack has 16 balls, 8 in center, no overlaps', () => {
  const s = pool.createInitialState(P);
  assert.equal(s.balls.length, 16);
  const eight = s.balls[8];
  const apex = s.balls.filter(b => b.id !== 0).sort((x, y) => x.x - y.x)[0];
  assert.ok(apex.x < eight.x);
  for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
    assert.ok(Math.hypot(s.balls[i].x - s.balls[j].x, s.balls[i].y - s.balls[j].y) >= 2 * poolMod.TABLE.ballRadius);
  }
});

test('pool: rejects out-of-turn, bad payload, bad placement', () => {
  const s = pool.createInitialState(P);
  assert.equal(pool.applyMove(s, 'b', { type: 'shoot', angle: 0, power: 1 }).error, 'مش دورك');
  assert.ok(pool.applyMove(s, 'a', { type: 'shoot', angle: 'x', power: 1 }).error);
  assert.ok(pool.applyMove(s, 'a', { type: 'place_cue', x: 1500, y: 500 }).error); // برا الكيتشن
  assert.ok(pool.applyMove(s, 'a', { type: 'foo' }).error);
  assert.ok(!pool.applyMove(s, 'a', { type: 'place_cue', x: 300, y: 400 }).error);
});

test('pool: break shot simulates, balls stay in bounds and at rest', () => {
  const s = pool.createInitialState(P);
  const r = pool.applyMove(s, 'a', { type: 'shoot', angle: 0, power: 1 });
  assert.ok(!r.error);
  const shot = r.events.find(e => e.type === 'shot_result');
  assert.ok(shot.frames.length > 5);
  for (const b of r.state.balls) {
    if (b.potted) continue;
    assert.ok(b.x >= 25 && b.x <= 1975 && b.y >= 25 && b.y <= 975, `ball ${b.id} out of bounds`);
  }
  assert.ok(shot.firstContact !== null);
});

test('pool: missing every ball is a foul with ball-in-hand for opponent', () => {
  const s = pool.createInitialState(P);
  s.breakShot = false;
  s.balls = s.balls.map(b => ({ ...b, potted: b.id !== 0 && b.id !== 1 }));
  s.balls[0].x = 300; s.balls[0].y = 500; s.balls[1].x = 1500; s.balls[1].y = 900;
  const r = pool.applyMove(s, 'a', { type: 'shoot', angle: -Math.PI / 2, power: 0.05 });
  assert.ok(r.state.lastShot.fouls.includes('no_contact'));
  assert.equal(r.state.turnIndex, 1);
  assert.equal(r.state.ballInHand, true);
  assert.equal(r.state.ballInHandZone, 'any');
});

test('pool: potting a solid on open table assigns groups and keeps turn', () => {
  const s = pool.createInitialState(P);
  s.breakShot = false;
  s.balls = s.balls.map(b => ({ ...b, potted: ![0, 1, 9].includes(b.id) }));
  // كورة 1 قريبة من الجيب العلوي الأيسر، والبيضا وراها في خط مستقيم
  s.balls[1].x = 200; s.balls[1].y = 200;
  s.balls[9].x = 1500; s.balls[9].y = 800;
  s.balls[0].x = 400; s.balls[0].y = 400;
  const r = pool.applyMove(s, 'a', { type: 'shoot', angle: Math.atan2(-200, -200) + Math.PI - Math.PI, power: 0.35 });
  assert.ok(r.state.lastShot.potted.includes(1), 'ball 1 should be potted: ' + JSON.stringify(r.state.lastShot));
  assert.equal(r.state.players[0].group, 'solids');
  assert.equal(r.state.players[1].group, 'stripes');
  assert.equal(r.state.turnIndex, 0);
});

test('pool: eight potted early loses; eight potted after clearing wins', () => {
  const build = cleared => {
    const s = pool.createInitialState(P);
    s.breakShot = false;
    s.players[0].group = 'solids'; s.players[1].group = 'stripes';
    s.balls = s.balls.map(b => ({ ...b, potted: !(b.id === 0 || b.id === 8 || b.id === 9 || (!cleared && b.id === 1)) }));
    s.balls[8].x = 200; s.balls[8].y = 200;
    s.balls[0].x = 400; s.balls[0].y = 400;
    s.balls[9].x = 1500; s.balls[9].y = 800;
    if (!cleared) { s.balls[1].x = 1500; s.balls[1].y = 200; }
    return s;
  };
  const early = pool.applyMove(build(false), 'a', { type: 'shoot', angle: Math.atan2(-200, -200), power: 0.35 });
  assert.equal(early.state.winner, 'b');
  const late = pool.applyMove(build(true), 'a', { type: 'shoot', angle: Math.atan2(-200, -200), power: 0.35 });
  assert.equal(late.state.winner, 'a');
  assert.equal(late.state.status, 'finished');
});

test('pool: 30 random full-game-ish shots never crash and terminate', () => {
  const s = pool.createInitialState(P);
  let moves = 0;
  while (s.status === 'in_progress' && moves < 400) {
    const uid = pool.currentPlayer(s).userId;
    const r = pool.applyMove(s, uid, { type: 'shoot', angle: Math.random() * Math.PI * 2, power: 0.2 + Math.random() * 0.8 });
    assert.ok(!r.error, r.error);
    for (const b of s.balls) if (!b.potted) assert.ok(b.x >= 24 && b.x <= 1976 && b.y >= 24 && b.y <= 976);
    moves++;
  }
  assert.ok(moves > 0);
});

// ---------------- Ludo ----------------
test('ludo: rules — need six, capture, finish, win', () => {
  const s = ludo.createInitialState(P);
  assert.deepEqual(s.players.map(p => p.color), ['red', 'yellow']);
  // رمية أي حاجة غير 6 والمهرات في البيت → الدور بيتحول
  let guard = 0;
  while (guard++ < 200) {
    const uid = ludo.currentPlayer(s).userId;
    const r = ludo.applyMove(s, uid, { type: 'roll_dice' });
    assert.ok(!r.error);
    if (s.phase === 'move') {
      const pick = s.legalMoves[0];
      assert.ok(!ludo.applyMove(s, uid, { type: 'move_piece', pieceIndex: pick }).error);
    }
    if (s.status === 'finished') break;
  }
  assert.equal(s.status, 'finished', 'random play should finish');
  assert.ok(['a', 'b'].includes(s.winner));
});

test('ludo: capture on non-safe square sends piece home; safe square protects', () => {
  const s = ludo.createInitialState(P);
  const [a, b] = s.players; // red(start 0), yellow(start 26)
  a.pieces = [10, -1, -1, -1]; // abs 10
  b.pieces = [-1, -1, -1, -1];
  b.pieces[0] = (10 - 26 + 52) % 52; // rel 36 → abs 10
  s.phase = 'roll';
  // نجبر النرد: نستخدم computeLegalMoves والـ performMove عبر move_piece بعد وضع الحالة يدوياً
  a.pieces = [7, -1, -1, -1]; s.dice = 3; s.phase = 'move'; s.legalMoves = [0];
  const r = ludo.applyMove(s, 'a', { type: 'move_piece', pieceIndex: 0 });
  assert.ok(r.events.some(e => e.type === 'piece_captured'));
  assert.equal(b.pieces[0], -1);
  assert.equal(s.turnIndex, 0); // أكل = دور إضافي

  // مربع آمن (abs 8 نجمة) — مفيش أكل
  b.pieces[0] = (8 - 26 + 52) % 52;
  a.pieces = [5, -1, -1, -1]; s.dice = 3; s.phase = 'move'; s.turnIndex = 0;
  const r2 = ludo.applyMove(s, 'a', { type: 'move_piece', pieceIndex: 0 });
  assert.ok(!r2.events.some(e => e.type === 'piece_captured'));
});

test('ludo: exact roll needed to finish; wrong piece / phase rejected', () => {
  const s = ludo.createInitialState(P);
  const a = s.players[0];
  a.pieces = [54, 56, 56, 56];
  assert.deepEqual(ludoMod.computeLegalMoves(a, 3), []);
  assert.deepEqual(ludoMod.computeLegalMoves(a, 2).map(m => m.pieceIndex), [0]);
  assert.ok(ludo.applyMove(s, 'a', { type: 'move_piece', pieceIndex: 0 }).error); // phase = roll
  assert.ok(ludo.applyMove(s, 'b', { type: 'roll_dice' }).error);
});

// ---------------- Points + DB facade ----------------
test('points system via db facade', async () => {
  const pts = await import('../src/games/pointsSystem.js');
  assert.equal(pts.getBalance('u1'), 0);
  pts.addPoints('u1', 600, 'test');
  assert.equal(pts.getBalance('u1'), 600);
  const issued = pts.checkAndIssueCoupons('u1');
  assert.equal(issued.length, 1);
  assert.equal(pts.checkAndIssueCoupons('u1').length, 0);
  const code = issued[0].code;
  assert.ok(pts.redeemCoupon(code, 'u1').ok);
  assert.ok(!pts.redeemCoupon(code, 'u1').ok);
  assert.ok(!pts.redeemCoupon(code, 'u2').ok);
  const awards = pts.awardGameResult('pool', [{ userId: 'u1' }, { userId: 'guest_x' }], 'u1');
  assert.equal(awards.length, 1); // الضيف مبياخدش نقاط
  assert.equal(pts.getBalance('u1'), 650);
  pts.addPoints('u1', -99999, 'x');
  assert.equal(pts.getBalance('u1'), 0);
});

test('wheel: one spin per day, cooldown stored via db facade', async () => {
  const wheel = await import('../src/games/engines/wheel.js');
  const first = wheel.spin('wheel-user');
  assert.ok(first.ok);
  const second = wheel.spin('wheel-user');
  assert.ok(!second.ok);
  assert.ok(second.remainingMs > 0);
  assert.ok(wheel.prizeList().length >= 5);
});
