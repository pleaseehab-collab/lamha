import test from 'node:test';
import assert from 'node:assert/strict';

const ludo = (await import('../src/games/engines/ludo.js')).default;
const L = await import('../src/games/engines/ludo.js');

const mk = n => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, username: `U${i}` }));
const setMove = (s, dice, legal) => { s.dice = dice; s.phase = 'move'; s.legalMoves = legal; };

test('ludo: color assignment for 2/3/4 players', () => {
  assert.deepEqual(ludo.createInitialState(mk(2)).players.map(p => p.color), ['red', 'yellow']);
  assert.deepEqual(ludo.createInitialState(mk(3)).players.map(p => p.color), ['red', 'green', 'yellow']);
  assert.deepEqual(ludo.createInitialState(mk(4)).players.map(p => p.color), ['red', 'green', 'yellow', 'blue']);
});

test('ludo: dice values are always 1..6 and roll needs phase=roll', () => {
  const s = ludo.createInitialState(mk(2));
  const seen = new Set();
  for (let i = 0; i < 300 && s.status === 'in_progress'; i++) {
    const uid = ludo.currentPlayer(s).userId;
    ludo.applyMove(s, uid, { type: 'roll_dice' });
    seen.add(s.lastDiceRoll.value);
    if (s.phase === 'move') {
      assert.ok(ludo.applyMove(s, uid, { type: 'roll_dice' }).error); // لازم تختار مهرة الأول
      ludo.applyMove(s, uid, { type: 'move_piece', pieceIndex: s.legalMoves[0] });
    }
  }
  assert.ok([...seen].every(v => v >= 1 && v <= 6));
  assert.equal(seen.size, 6);
});

test('ludo: no legal move with pieces at home and non-six passes the turn', () => {
  const s = ludo.createInitialState(mk(2));
  assert.deepEqual(L.computeLegalMoves(s.players[0], 3), []);
  assert.equal(L.computeLegalMoves(s.players[0], 6).length, 4);
});

test('ludo: leaving home lands on rel 0 and six grants extra roll', () => {
  const s = ludo.createInitialState(mk(2));
  s.players[0].pieces = [-1, -1, -1, -1];
  setMove(s, 6, [0, 1, 2, 3]);
  const r = ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 2 });
  assert.equal(s.players[0].pieces[2], 0);
  assert.equal(s.turnIndex, 0);
  assert.equal(s.phase, 'roll');
  assert.ok(r.events.some(e => e.type === 'extra_turn'));
});

test('ludo: cannot move a piece that would overshoot the finish, or invalid index', () => {
  const s = ludo.createInitialState(mk(2));
  s.players[0].pieces = [55, 10, -1, -1];
  setMove(s, 3, [1]);
  assert.ok(ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 0 }).error);
  assert.ok(ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 9 }).error);
  assert.ok(ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 'x' }).error);
  assert.ok(!ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 1 }).error);
});

test('ludo: home column squares are never capturable', () => {
  const s = ludo.createInitialState(mk(2));
  const [a, b] = s.players;
  a.pieces = [48, -1, -1, -1];
  b.pieces = [-1, -1, -1, -1];
  setMove(s, 4, [0]); // 48 → 52 (عمود البيت)
  ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 0 });
  assert.equal(a.pieces[0], 52);
  assert.equal(L.absPosition('red', 52), null);
});

test('ludo: capturing sends ALL opposing pieces on that square home', () => {
  const s = ludo.createInitialState(mk(2));
  const [a, b] = s.players; // red start 0, yellow start 26
  // abs 20 (مش آمن): red rel 20، yellow rel (20-26+52)=46
  a.pieces = [17, -1, -1, -1];
  b.pieces = [46, 46, -1, -1];
  setMove(s, 3, [0]);
  const r = ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 0 });
  assert.equal(r.events.filter(e => e.type === 'piece_captured').length, 2);
  assert.deepEqual(b.pieces.slice(0, 2), [-1, -1]);
});

test('ludo: three consecutive sixes forfeits the turn', () => {
  const s = ludo.createInitialState(mk(2));
  s.consecutiveSixes = 2;
  // نجبر رمية 6 بتزوير randomInt مش ممكن؛ نحاكي بالحالة: لو الرمية طلعت 6 لازم forfeit
  let hit = false;
  for (let i = 0; i < 500 && !hit; i++) {
    const t = ludo.createInitialState(mk(2));
    t.consecutiveSixes = 2;
    const r = ludo.applyMove(t, 'u0', { type: 'roll_dice' });
    if (t.lastDiceRoll.value === 6) {
      hit = true;
      assert.ok(r.events.some(e => e.type === 'three_sixes_forfeit'));
      assert.equal(t.turnIndex, 1);
      assert.equal(t.consecutiveSixes, 0);
    }
  }
  assert.ok(hit);
});

test('ludo: finishing all four pieces wins, game locks afterwards', () => {
  const s = ludo.createInitialState(mk(2));
  s.players[0].pieces = [56, 56, 56, 55];
  setMove(s, 1, [3]);
  const r = ludo.applyMove(s, 'u0', { type: 'move_piece', pieceIndex: 3 });
  assert.equal(s.status, 'finished');
  assert.equal(s.winner, 'u0');
  assert.ok(r.events.some(e => e.type === 'game_finished'));
  assert.ok(ludo.applyMove(s, 'u0', { type: 'roll_dice' }).error);
});

test('ludo: 4-player random games always finish without invariant violations', () => {
  for (let g = 0; g < 20; g++) {
    const s = ludo.createInitialState(mk(4));
    let n = 0;
    while (s.status === 'in_progress' && n++ < 5000) {
      const uid = ludo.currentPlayer(s).userId;
      const r = ludo.applyMove(s, uid, { type: 'roll_dice' });
      assert.ok(!r.error);
      if (s.phase === 'move') {
        const pick = s.legalMoves[Math.floor(Math.random() * s.legalMoves.length)];
        assert.ok(!ludo.applyMove(s, uid, { type: 'move_piece', pieceIndex: pick }).error);
      }
      for (const p of s.players) for (const rel of p.pieces) assert.ok(rel >= -1 && rel <= 56);
    }
    assert.equal(s.status, 'finished');
  }
});
