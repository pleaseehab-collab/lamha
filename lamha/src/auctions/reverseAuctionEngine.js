import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger.js';

/**
 * محرك المزادات العكسية — Server-Authoritative بالكامل:
 *  - السعر الحالي دايماً بيتحسب من وقت السيرفر (Date.now())، مش من أي
 *    قيمة بيبعتها العميل، عشان محدش يقدر "يغش" ويقول إن السعر وصل لأقل
 *    من قيمته الحقيقية.
 *  - أول مستخدم "يقبل" (accept) بيقفل المزاد فوراً وبشكل ذرّي (atomic) —
 *    الفحص والقفل بيحصلوا في نفس الدالة المتزامنة (synchronous) عشان
 *    Node.js بيعالج الـ event loop tick واحد في المرة، فمفيش race condition
 *    ممكن يحصل بين فحص "المزاد لسه مفتوح؟" وتحديث "اتقفل".
 *    ⚠️ الضمان ده صحيح جوه instance واحدة بس — لو المشروع اشتغل على أكتر
 *    من نسخة سيرفر (horizontal scaling)، لازم القفل ده يتنقل لـ Redis
 *    (SETNX) أو transaction في قاعدة البيانات عشان يفضل atomic.
 */

const auctions = new Map();

export function createAuction({ dealId, title, startPrice, floorPrice, dropAmount, dropIntervalMs, durationMs }) {
  if (!(startPrice > floorPrice)) throw new Error('startPrice لازم يكون أكبر من floorPrice.');
  const id = uuid();
  const now = Date.now();
  const auction = {
    id,
    dealId,
    title,
    startPrice,
    floorPrice,
    dropAmount,
    dropIntervalMs,
    startedAt: now,
    endsAt: now + durationMs,
    status: 'active', // active | won | expired
    winnerId: null,
    finalPrice: null
  };
  auctions.set(id, auction);
  return auction;
}

/** السعر الحالي محسوب دايماً سيرفر-سايد من الوقت — مينفعش يتحقن من العميل */
export function currentPrice(auction) {
  if (auction.status !== 'active') return auction.finalPrice ?? auction.floorPrice;
  const elapsed = Date.now() - auction.startedAt;
  const drops = Math.floor(elapsed / auction.dropIntervalMs);
  const price = auction.startPrice - drops * auction.dropAmount;
  return Math.max(auction.floorPrice, Math.round(price * 100) / 100);
}

export function getPublicState(id) {
  const auction = auctions.get(id);
  if (!auction) return null;
  maybeExpire(auction);
  return {
    id: auction.id,
    dealId: auction.dealId,
    title: auction.title,
    price: currentPrice(auction),
    floorPrice: auction.floorPrice,
    status: auction.status,
    endsAt: auction.endsAt,
    winnerId: auction.status === 'won' ? auction.winnerId : null
  };
}

function maybeExpire(auction) {
  if (auction.status === 'active' && Date.now() >= auction.endsAt) {
    auction.status = 'expired';
  }
}

/**
 * قبول العرض — أول نداء بيوصل وهو لسه active بيكسب فورًا. أي نداء بعده
 * (حتى لو وصل بعده بمللي ثانية) هيرفض لأن status اتغيّر خلاص لـ 'won'.
 */
export function acceptAuction(id, userId) {
  const auction = auctions.get(id);
  if (!auction) return { ok: false, error: 'مزاد غير موجود.' };
  maybeExpire(auction);

  if (auction.status !== 'active') {
    return { ok: false, error: auction.status === 'won' ? 'اتقفل، حد تاني كسب المزاد ده.' : 'المزاد انتهى.' };
  }

  // --- القفل الذرّي: تحديث الحالة فورًا وبشكل متزامن قبل أي await ---
  auction.status = 'won';
  auction.winnerId = userId;
  auction.finalPrice = currentPrice(auction);

  logger.info('مزاد عكسي اتقفل', { auctionId: id, winnerId: userId, finalPrice: auction.finalPrice });
  return { ok: true, auction: getPublicState(id) };
}

export function listActive() {
  return [...auctions.values()]
    .map(a => { maybeExpire(a); return a; })
    .filter(a => a.status === 'active')
    .map(a => getPublicState(a.id));
}

export default { createAuction, currentPrice, getPublicState, acceptAuction, listActive };
