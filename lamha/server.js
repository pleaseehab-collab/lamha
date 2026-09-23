import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env, assertProductionSecrets } from './src/config/env.js';
import { logger } from './src/utils/logger.js';
import { helmetConfig } from './src/security/helmetConfig.js';
import { privacyHeaders } from './src/security/privacyHeaders.js';
import { apiLimiter } from './src/security/rateLimiter.js';
import routes from './src/routes/index.js';
import { notFoundHandler, errorHandler } from './src/middleware/errorHandler.js';
import { attachChat } from './src/chat/socket.js';
import { attachGames } from './src/games/gamesSocket.js';
import { attachAuctions } from './src/auctions/auctionsSocket.js';
import { startDealsScheduler } from './src/deals/scheduler.js';
import { publishToFacebook } from './src/publishing/facebookPublisher.js';
import { publishToWhatsapp } from './src/publishing/whatsappPublisher.js';

/**
 * نقطة تشغيل لمحة: Express + Socket.io (namespaces: /chat, /games, /auctions).
 * الـ Socket.io client بيتقدّم تلقائياً من /socket.io/socket.io.js (بيستخدمه ludo.html).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

// يرفض الإقلاع في production بمفاتيح افتراضية أو من غير ADMIN_PASSWORD_HASH/ADMIN_IP_WHITELIST
try {
  assertProductionSecrets();
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by'); // مبنكشفش إن السيرفر Express
app.set('trust proxy', 1); // req.ip صح ورا reverse proxy
const httpServer = createServer(app);

const io = new Server(httpServer, {
  serveClient: true,
  cors: { origin: env.CORS_ORIGINS, credentials: true }
});

app.use(helmetConfig);
app.use(privacyHeaders);
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api', apiLimiter);
app.use('/', routes);

// الصفحة الرئيسية → المتجر
app.get('/', (req, res) => res.redirect(302, '/shop.html'));

// الواجهة الثابتة (GET/HEAD فقط — أي طريقة تانية مش بتوصل لملفات)
app.use(
  express.static(PUBLIC_DIR, {
    index: 'shop.html',
    extensions: ['html'],
    dotfiles: 'deny',
    maxAge: env.NODE_ENV === 'production' ? '1h' : 0
  })
);

app.use(notFoundHandler);
app.use(errorHandler);

if (!fs.existsSync(path.join(PUBLIC_DIR, 'shop.html'))) {
  logger.warn(`⚠️ ملف الواجهة مش موجود: ${path.join(PUBLIC_DIR, 'shop.html')} — شغّل السيرفر من جذر المشروع`);
}

attachChat(io);
attachGames(io);
attachAuctions(io);

if (env.deals.autoUpdate) {
  startDealsScheduler({
    hour: env.deals.updateHourCairo,
    publish: env.deals.autoPublish,
    publishers: { facebook: publishToFacebook, whatsapp: publishToWhatsapp }
  });
}

httpServer.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`لمحة سيرفر شغّال على http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
  logger.info('Socket.io namespaces: /chat, /games, /auctions');
});

process.on('unhandledRejection', err => logger.error('Unhandled Rejection', err));
process.on('uncaughtException', err => logger.error('Uncaught Exception', err));

