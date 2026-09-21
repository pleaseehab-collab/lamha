import * as engine from './reverseAuctionEngine.js';
import { requireSocketAuth } from '../security/socketAuth.js';

const TICK_MS = 1000;

/**
 * @param {import('socket.io').Server} io
 */
export function attachAuctions(io) {
  const ns = io.of('/auctions');
  ns.use(requireSocketAuth);

  ns.on('connection', socket => {
    socket.emit('auctions:list', engine.listActive());

    socket.on('auctions:join', auctionId => {
      socket.join(`auction:${auctionId}`);
      const state = engine.getPublicState(auctionId);
      if (state) socket.emit('auctions:state', state);
    });

    // المستخدم بيبعت نيّته "أقبل" بس — مفيش أي سعر أو نتيجة بييجي من
    // العميل، كل حاجة بتتحسب وتتقرر سيرفر-سايد فقط (anti-cheat).
    socket.on('auctions:accept', auctionId => {
      const result = engine.acceptAuction(auctionId, socket.data.userId);
      if (!result.ok) return socket.emit('auctions:error', { error: result.error });
      ns.to(`auction:${auctionId}`).emit('auctions:won', result.auction);
    });
  });

  // تحديث دوري لكل المزادات المفتوحة — العميل بيستقبل السعر بس، مايحسبوش
  setInterval(() => {
    for (const state of engine.listActive()) {
      ns.to(`auction:${state.id}`).emit('auctions:state', state);
    }
  }, TICK_MS).unref();

  return ns;
}

export default { attachAuctions };
