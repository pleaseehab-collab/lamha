import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger.js';

/**
 * سوق الكوبونات — طبقة فوق نظام النقاط الموجود (pointsSystem.js).
 * التجار بينشروا كوبونات خصم حقيقية (كود يستخدم عند المتجر الخارجي)،
 * والمستخدمين بيقدروا "يطالبوا" (claim) بيها — مرة واحدة لكل مستخدم لكل
 * كوبون، ومحدودة بعدد مرات استخدام (maxClaims) يحدده التاجر.
 */

const listings = new Map(); // id -> { id, merchantId, title, code, discountLabel, maxClaims, claimedBy:Set }

export function publishCoupon({ merchantId, title, code, discountLabel, maxClaims, expiresAt }) {
  if (!code) throw new Error('كود الكوبون مطلوب.');
  const id = uuid();
  const listing = {
    id,
    merchantId,
    title,
    code,
    discountLabel,
    maxClaims: maxClaims || 100,
    claimedBy: new Set(),
    expiresAt: expiresAt || null,
    createdAt: Date.now()
  };
  listings.set(id, listing);
  logger.info('كوبون جديد اتنشر في السوق', { id, merchantId, title });
  return getPublicListing(id);
}

function isExpired(listing) {
  return listing.expiresAt && Date.now() > listing.expiresAt;
}

export function getPublicListing(id) {
  const l = listings.get(id);
  if (!l) return null;
  return {
    id: l.id,
    merchantId: l.merchantId,
    title: l.title,
    discountLabel: l.discountLabel,
    remaining: Math.max(0, l.maxClaims - l.claimedBy.size),
    expired: isExpired(l)
  };
}

export function claim(id, userId) {
  const l = listings.get(id);
  if (!l) return { ok: false, error: 'كوبون غير موجود.' };
  if (isExpired(l)) return { ok: false, error: 'الكوبون انتهت صلاحيته.' };
  if (l.claimedBy.has(userId)) return { ok: false, error: 'استلمت الكوبون ده قبل كده.' };
  if (l.claimedBy.size >= l.maxClaims) return { ok: false, error: 'خلصت الكمية المتاحة من الكوبون ده.' };

  l.claimedBy.add(userId);
  return { ok: true, code: l.code, discountLabel: l.discountLabel };
}

export function listActive() {
  return [...listings.values()].filter(l => !isExpired(l)).map(l => getPublicListing(l.id));
}

export default { publishCoupon, claim, getPublicListing, listActive };
