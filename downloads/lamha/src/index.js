import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { env, assertProductionSecrets } from './config/env.js';
import { logger } from './utils/logger.js';
import { helmetConfig } from './security/helmetConfig.js';
import { apiLimiter } from './security/rateLimiter.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { attachChat } from './chat/socket.js';
import { attachGames } from './games/gamesSocket.js';
import { attachAuctions } from './auctions/auctionsSocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ⚠️ لازم يتنفذ قبل أي حاجة تانية: يرفض تشغيل السيرفر في production لو
// لسه فيه مفاتيح سرية افتراضية غير آمنة (JWT/webhook/fraud salt) أو
// ADMIN_IP_WHITELIST فاضية — أحسن من اكتشاف الموضوع بعد اختراق فعلي.
try {
  assertProductionSecrets();
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: env.CORS_ORIGINS, credentials: true }
});

app.set('trust proxy', 1); // مهم عشان req.ip يبقى صح لو ورا reverse proxy / load balancer

app.use(helmetConfig);
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '256kb' }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.use('/api', apiLimiter);
app.use('/', routes);
app.use(express.static(PUBLIC_DIR));

app.use(notFoundHandler);
app.use(errorHandler);

attachChat(io);
attachGames(io);
attachAuctions(io);

httpServer.listen(env.PORT, () => {
  logger.info(`لمحة سيرفر شغّال على http://localhost:${env.PORT} (${env.NODE_ENV})`);
  logger.info('Socket.io namespaces: /chat, /games, /auctions');
});

process.on('unhandledRejection', err => logger.error('Unhandled Rejection', err));
process.on('uncaughtException', err => logger.error('Uncaught Exception', err));
