import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lamha-db-'));
const dbFile = path.join(tmp, 'db.json');

// كل استدعاء = "عملية سيرفر" مستقلة (زي restart حقيقي)
function run(code) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root,
    env: { ...process.env, DB_DRIVER: 'file', DB_FILE: dbFile },
    encoding: 'utf8'
  }).trim().split('\n').pop();
}

test('persistence: points, ledger and coupons survive a process restart', () => {
  run(`
    const p = await import('./src/games/pointsSystem.js');
    p.addPoints('user-1', 700, 'seed');
    p.checkAndIssueCoupons('user-1');
    console.log('ok');
  `);
  assert.ok(fs.existsSync(dbFile), 'db file should be written on exit');

  const out = JSON.parse(run(`
    const p = await import('./src/games/pointsSystem.js');
    console.log(JSON.stringify({ bal: p.getBalance('user-1'), hist: p.getHistory('user-1').length, coupons: p.listCoupons('user-1') }));
  `));
  assert.equal(out.bal, 700);
  assert.equal(out.hist, 1);
  assert.equal(out.coupons.length, 1);
  assert.equal(out.coupons[0].redeemed, false);
});

test('persistence: redeemed coupon stays redeemed after restart', () => {
  const code = JSON.parse(run(`
    const p = await import('./src/games/pointsSystem.js');
    const c = p.listCoupons('user-1')[0].code;
    console.log(JSON.stringify({ code: c, r: p.redeemCoupon(c, 'user-1').ok }));
  `));
  assert.equal(code.r, true);
  const again = run(`
    const p = await import('./src/games/pointsSystem.js');
    console.log(p.redeemCoupon(${JSON.stringify(code.code)}, 'user-1').ok);
  `);
  assert.equal(again, 'false');
});

test('persistence: users survive restart and password login still works', () => {
  run(`
    const u = await import('./src/users/userStore.js');
    const r = u.createUser({ email: 'Test@Example.com', password: 'S3cret-pass!' });
    if (!r.ok) throw new Error(r.error);
    u.creditWallet(r.user.id, 12.5, 'test');
    console.log('ok');
  `);
  const out = JSON.parse(run(`
    const u = await import('./src/users/userStore.js');
    const login = u.verifyLogin('test@example.com', 'S3cret-pass!');
    const bad = u.verifyLogin('test@example.com', 'wrong');
    console.log(JSON.stringify({ ok: login.ok, bad: bad.ok, wallet: login.user?.wallet, dup: u.createUser({ email: 'test@example.com', password: 'x' }).ok }));
  `));
  assert.equal(out.ok, true);
  assert.equal(out.bad, false);
  assert.equal(out.wallet.balance, 12.5);
  assert.equal(out.dup, false);
});

test('persistence: corrupted db file does not crash startup (starts empty)', () => {
  fs.writeFileSync(dbFile, '{not json');
  const out = run(`
    const p = await import('./src/games/pointsSystem.js');
    console.log(p.getBalance('user-1'));
  `);
  assert.equal(out, '0');
});

test('persistence: memory driver never writes to disk', () => {
  const f = path.join(tmp, 'mem.json');
  execFileSync(process.execPath, ['--input-type=module', '-e',
    `const p = await import('./src/games/pointsSystem.js'); p.addPoints('x', 5);`], {
    cwd: root, env: { ...process.env, DB_DRIVER: 'memory', DB_FILE: f }
  });
  assert.ok(!fs.existsSync(f));
});

test('lobby integration: pool win awards points exactly once and only to real users', async () => {
  process.env.DB_DRIVER = 'memory';
  const lm = await import('../src/games/lobbyManager.js');
  const pts = await import('../src/games/pointsSystem.js');
  const lobby = lm.createLobby('pool', { userId: 'real-A', username: 'A' });
  lm.joinLobby(lobby.id, { userId: 'guest_B', username: 'B' });
  assert.ok(lm.startGame(lobby.id, 'real-A').ok);
  // نجهّز حالة قبل الفوز مباشرة: مجموعة real-A خلصت والسودا جنب الجيب
  const s = lobby.state;
  s.breakShot = false;
  s.players[0].group = 'solids';
  s.players[1].group = 'stripes';
  s.balls = s.balls.map(b => ({ ...b, potted: !(b.id === 0 || b.id === 8 || b.id === 9) }));
  s.balls[8].x = 200; s.balls[8].y = 200;
  s.balls[0].x = 400; s.balls[0].y = 400;
  s.balls[9].x = 1500; s.balls[9].y = 800;
  s.ballInHand = false;
  const r = lm.applyMove(lobby.id, 'real-A', { type: 'shoot', angle: Math.atan2(-200, -200), power: 0.35 });
  assert.ok(r.ok, r.error);
  assert.equal(r.lobby.status, 'finished');
  assert.equal(r.awards.length, 1);
  assert.equal(pts.getBalance('real-A'), 50);
  assert.equal(pts.getBalance('guest_B'), 0);
  // حركة تانية بعد النهاية مرفوضة ومفيش مكافأة مكررة
  assert.ok(!lm.applyMove(lobby.id, 'real-A', { type: 'shoot', angle: 0, power: 1 }).ok);
  assert.equal(pts.getBalance('real-A'), 50);
});

test('uno/domino: playing cards or tiles not in your hand is rejected', async () => {
  const uno = (await import('../src/games/engines/uno.js')).default;
  const domino = (await import('../src/games/engines/domino.js')).default;
  const P = [{ userId: 'a', username: 'A' }, { userId: 'b', username: 'B' }];

  const u = uno.createInitialState(P);
  const hand = u.hands.a.length;
  assert.ok(uno.applyMove(u, 'a', { type: 'play_card', card: { color: 'red', value: '99' } }).error);
  assert.ok(uno.applyMove(u, 'a', { type: 'play_card' }).error);
  assert.equal(u.hands.a.length, hand);
  // كارت مطابق فعلاً يتقبل ويشيل نسخة واحدة بس
  u.discardPile = [{ color: 'red', value: '5' }];
  u.hands.a = [{ color: 'red', value: '3' }, { color: 'red', value: '3' }, { color: 'blue', value: '9' }];
  assert.ok(uno.applyMove(u, 'a', { type: 'play_card', card: { color: 'blue', value: '9' } }).error); // مبيطابقش
  assert.ok(!uno.applyMove(u, 'a', { type: 'play_card', card: { color: 'red', value: '3' } }).error);
  assert.equal(u.hands.a.filter(c => c.value === '3').length, 1);

  const d = domino.createInitialState(P);
  assert.ok(domino.applyMove(d, 'a', { type: 'play_tile', tile: [9, 9] }).error);
  const tile = d.hands.a[0];
  assert.ok(!domino.applyMove(d, 'a', { type: 'play_tile', tile: [tile[1], tile[0]] }).error);
});
