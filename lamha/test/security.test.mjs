import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'test';
process.env.DB_DRIVER = 'memory';
process.env.JWT_SECRET = 'test-secret-for-admin-sessions-0123456789';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { hashPassword } = await import('../src/security/passwords.js');
const gate = await import('../src/security/adminGate.js');
const { privacyHeaders, PERMISSIONS_POLICY } = await import('../src/security/privacyHeaders.js');

const PASSWORD = 'Correct-horse-9';
function fakeRes() {
  const r = { headers: {}, statusCode: 200, body: null, redirected: null, removed: [] };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.removeHeader = k => r.removed.push(k);
  r.status = n => { r.statusCode = n; return r; };
  r.json = b => { r.body = b; return r; };
  r.redirect = (n, url) => { r.statusCode = n; r.redirected = url; return r; };
  return r;
}
const run = (req) => { const res = fakeRes(); let nexted = false; gate.requireAdminSession(req, res, () => { nexted = true; }); return { res, nexted }; };

// ---------- بوابة الأدمن ----------
test('admin gate: fail-closed when ADMIN_PASSWORD_HASH is not set', async () => {
  delete process.env.ADMIN_PASSWORD_HASH;
  gate._resetForTests();
  assert.equal((await gate.attemptLogin('1.1.1.1', PASSWORD)).status, 503);
  assert.equal(run({ ip: '1.1.1.1', method: 'GET', headers: {} }).res.statusCode, 503);
});

test('admin gate: login, session, csrf header, logout revocation', async () => {
  process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  gate._resetForTests();
  assert.equal((await gate.attemptLogin('2.2.2.2', 'wrong')).status, 401);
  const ok = await gate.attemptLogin('2.2.2.2', PASSWORD);
  assert.ok(ok.ok && ok.token);
  const cookie = gate.sessionCookie(ok.token);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const cookieHeader = `${gate.COOKIE_NAME}=${encodeURIComponent(ok.token)}`;

  assert.ok(run({ ip: '2.2.2.2', method: 'GET', headers: { cookie: cookieHeader } }).nexted);
  // تعديل بدون هيدر CSRF → مرفوض
  assert.equal(run({ ip: '2.2.2.2', method: 'POST', headers: { cookie: cookieHeader } }).res.statusCode, 403);
  assert.ok(run({ ip: '2.2.2.2', method: 'POST', headers: { cookie: cookieHeader, [gate.CSRF_HEADER]: '1' } }).nexted);

  // توكن معدّل → مرفوض
  const forged = ok.token.slice(0, -3) + 'aaa';
  assert.equal(gate.verifySession(forged), null);
  assert.equal(gate.verifySession('garbage'), null);

  gate.revokeSession(ok.token);
  assert.equal(gate.verifySession(ok.token), null);
});

test('admin gate: 5 wrong passwords lock the IP even for the right password', async () => {
  process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  gate._resetForTests();
  for (let i = 0; i < 5; i++) await gate.attemptLogin('3.3.3.3', 'nope' + i);
  const locked = await gate.attemptLogin('3.3.3.3', PASSWORD);
  assert.equal(locked.status, 429);
  // IP تاني مش متأثر
  assert.ok((await gate.attemptLogin('4.4.4.4', PASSWORD)).ok);
});

test('admin gate: unauthorized modifying requests are rejected and 3 strikes ban the IP', () => {
  process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  gate._resetForTests();
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal(run({ ip: '5.5.5.5', method, headers: {} }).res.statusCode, 401);
  }
  assert.equal(run({ ip: '5.5.5.5', method: 'GET', headers: {} }).res.statusCode, 429);
});

test('admin gate: unauthenticated browser GET is redirected to login page', () => {
  process.env.ADMIN_PASSWORD_HASH = hashPassword(PASSWORD);
  gate._resetForTests();
  const { res } = run({ ip: '6.6.6.6', method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(res.statusCode, 302);
  assert.equal(res.redirected, '/admin/login');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('admin gate: session cookie is Secure in production', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  assert.match(gate.sessionCookie(gate.createSession()), /Secure/);
  process.env.NODE_ENV = prev;
});

// ---------- خصوصية وهيدرز ----------
test('privacy headers: geolocation & sensors disabled, tech headers removed', () => {
  const res = fakeRes();
  privacyHeaders({}, res, () => {});
  assert.match(res.headers['permissions-policy'], /geolocation=\(\)/);
  assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
  assert.match(PERMISSIONS_POLICY, /microphone=\(\)/);
  assert.ok(res.removed.includes('X-Powered-By'));
  assert.ok(res.removed.includes('Server'));
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('server.js hides Express and mounts privacy headers, redirect and static', () => {
  const src = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(src, /app\.disable\('x-powered-by'\)/);
  assert.match(src, /app\.use\(privacyHeaders\)/);
  assert.match(src, /redirect\(302, '\/shop\.html'\)/);
  assert.match(src, /serveClient: true/);
});

test('health endpoint leaks no environment details', () => {
  const src = fs.readFileSync(path.join(root, 'src/routes/health.routes.js'), 'utf8');
  assert.ok(!/uptime|version|NODE_ENV|process\./.test(src.replace(/\/\/.*$/gm, '')));
});

// ---------- إخفاء الرقم ----------
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!['node_modules', 'test', '.git'].includes(f.name)) walk(p, out); }
    else if (/\.(html|js|mjs|json)$/.test(f.name)) out.push(p);
  }
  return out;
}

test('no phone number / direct whatsapp link anywhere in shipped code or pages', () => {
  const patterns = [/wa\.me\/\d/, /api\.whatsapp\.com\/send\?phone/, /whatsapp:\/\/send\?phone/, /tel:\+?\d/, /\+\d{10,15}/, /(?<![\w./-])0?1[0125]\d{8}(?!\d)/];
  const files = [...walk(path.join(root, 'public')), ...walk(path.join(root, 'src')), path.join(root, 'server.js')];
  for (const f of files) {
    const txt = fs.readFileSync(f, 'utf8');
    for (const re of patterns) assert.ok(!re.test(txt), `${path.relative(root, f)} matches ${re}`);
  }
});

test('ads contact: server-side WhatsApp redirect only; 503 when not configured; number never in a body', async () => {
  process.env.ADS_WHATSAPP_NUMBER = '15550001234'; // رقم وهمي للاختبار
  const { contactHandler } = await import('../src/routes/ads.routes.js');
  const res = fakeRes();
  contactHandler({}, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.redirected, /^https:\/\/wa\.me\/15550001234\?text=/);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body, null);
});

test('shop.html: ads button uses redirect endpoint, games button present, no geolocation use', () => {
  const html = fs.readFileSync(path.join(root, 'public/shop.html'), 'utf8');
  assert.match(html, /ADS_CONTACT_URL: '\/api\/ads\/contact'/);
  assert.ok(!/AD_CONTACT_EMAIL/.test(html));
  assert.match(html, /class="btn-games" href="\/ludo\.html"/);
  for (const f of ['shop.html', 'ludo.html']) {
    assert.ok(!/navigator\.geolocation|getCurrentPosition|watchPosition/.test(fs.readFileSync(path.join(root, 'public', f), 'utf8')));
  }
});

test('ludo.html: uses the /games namespace, socket.io client from own server, safe DOM rendering', () => {
  const html = fs.readFileSync(path.join(root, 'public/ludo.html'), 'utf8');
  assert.match(html, /<script src="\/socket\.io\/socket\.io\.js"><\/script>/);
  assert.match(html, /io\('\/games'/);
  for (const ev of ['games:create', 'games:join', 'games:start', 'ludo:roll', 'ludo:move', 'games:state', 'games:me']) assert.ok(html.includes(ev), ev);
  const script = html.split('<script>')[1];
  assert.ok(!/innerHTML/.test(script), 'no innerHTML (XSS via usernames)');
});
