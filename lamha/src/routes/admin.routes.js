import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { requireAdminIp } from '../security/ipWhitelist.js';
import {
  requireAdminSession, attemptLogin, sessionCookie, revokeSession, parseCookies,
  isConfigured, COOKIE_NAME, verifySession, CSRF_HEADER
} from '../security/adminGate.js';
import { recordAdminAction, listAuditLog } from '../security/auditLog.js';
import { runUpdateExclusive, configFromEnv, DEALS_FILE } from '../deals/dealsUpdater.js';
import { publishToFacebook } from '../publishing/facebookPublisher.js';
import { publishToWhatsapp } from '../publishing/whatsappPublisher.js';
import { env } from '../config/env.js';

/**
 * لوحة /admin — كل المسارات هنا محمية بـ: قائمة IP (لو متحددة) + كلمة سر + جلسة.
 * صفحات HTML بتتقدّم من src/admin/ (مش من public/) عشان محدش يوصلها من غير تسجيل دخول.
 */
const router = Router();
const view = name => fileURLToPath(new URL(`../admin/${name}`, import.meta.url));
const actor = { id: 'admin-panel', role: 'admin' };

router.use('/admin', requireAdminIp);

// ---- تسجيل الدخول (غير محمي بالجلسة، لكن محمي بالقفل ضد التخمين) ----
router.get('/admin/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (verifySession(parseCookies(req.headers.cookie || '')[COOKIE_NAME])) return res.redirect(302, '/admin');
  res.sendFile(view('login.html'));
});

router.post('/admin/login', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers[CSRF_HEADER] !== '1') return res.status(403).json({ error: 'طلب مرفوض.' });
    const result = await attemptLogin(req.ip, req.body?.password);
    recordAdminAction({ action: 'admin.login', actor, ip: req.ip, result: result.ok ? 'success' : 'denied' });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.setHeader('Set-Cookie', sessionCookie(result.token));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---- كل اللي تحت محتاج جلسة ----
router.use('/admin', requireAdminSession);

router.get('/admin', (req, res) => res.sendFile(view('dashboard.html')));

router.post('/admin/logout', (req, res) => {
  revokeSession(parseCookies(req.headers.cookie || '')[COOKIE_NAME]);
  res.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
  recordAdminAction({ action: 'admin.logout', actor, ip: req.ip });
  res.json({ ok: true });
});

router.get('/admin/api/status', async (req, res, next) => {
  try {
    const deals = JSON.parse(await readFile(DEALS_FILE, 'utf8'));
    const cfg = configFromEnv();
    res.json({
      admin: { configured: isConfigured() },
      deals: { total: deals.products?.length || 0, sample: !!deals.sample, updatedAt: deals.updatedAt },
      feeds: Object.fromEntries(Object.entries(cfg.feeds).map(([k, v]) => [k, v ? 'configured' : 'missing'])),
      ai: env.ai.apiKey ? 'configured' : 'heuristic-only',
      autoUpdate: env.deals.autoUpdate,
      autoPublish: env.deals.autoPublish
    });
  } catch (err) { next(err); }
});

router.post('/admin/api/update-deals', async (req, res, next) => {
  try {
    const publish = req.body?.publish === true;
    const reclassify = req.body?.reclassify === true;
    const report = await runUpdateExclusive({
      config: configFromEnv(), publish, reclassify,
      publishers: { facebook: publishToFacebook, whatsapp: publishToWhatsapp }
    });
    recordAdminAction({ action: 'deals.update', actor, ip: req.ip, meta: { publish, reclassify, busy: !!report.busy } });
    res.json(report);
  } catch (err) { next(err); }
});

router.get('/admin/api/audit', (req, res) => res.json({ entries: listAuditLog(50) }));

export default router;
