import { v4 as uuid } from 'uuid';
import { logger } from '../utils/logger.js';

/**
 * محرك الشراء الجماعي — عرض بيفتح بسعر عادي، وكل ما عدد المشتركين
 * يوصل لعتبة (tier) معينة، السعر بينزل لكل المشتركين تلقائي (حتى اللي
 * اشترك قبل ما يكمل العدد). Server-Authoritative: العدد والسعر بيتحسبوا
 * من عدد الاشتراكات الفعلي المخزّن سيرفر-سايد، مش من أي قيمة من العميل.
 */

const campaigns = new Map();

export function createCampaign({ dealId, title, basePrice, tiers, durationMs }) {
  // tiers: [{ minParticipants: number, price: number }, ...] مرتبة تصاعدياً بعدد المشتركين
  const id = uuid();
  const campaign = {
    id,
    dealId,
    title,
    basePrice,
    tiers: [...tiers].sort((a, b) => a.minParticipants - b.minParticipants),
    participants: new Set(),
    endsAt: Date.now() + durationMs,
    status: 'active'
  };
  campaigns.set(id, campaign);
  return getPublicState(id);
}

function currentTierPrice(campaign) {
  let price = campaign.basePrice;
  for (const tier of campaign.tiers) {
    if (campaign.participants.size >= tier.minParticipants) price = tier.price;
  }
  return price;
}

function nextTier(campaign) {
  return campaign.tiers.find(t => campaign.participants.size < t.minParticipants) || null;
}

function maybeExpire(campaign) {
  if (campaign.status === 'active' && Date.now() >= campaign.endsAt) campaign.status = 'closed';
}

export function getPublicState(id) {
  const c = campaigns.get(id);
  if (!c) return null;
  maybeExpire(c);
  return {
    id: c.id,
    dealId: c.dealId,
    title: c.title,
    participantsCount: c.participants.size,
    currentPrice: currentTierPrice(c),
    nextTier: nextTier(c),
    status: c.status,
    endsAt: c.endsAt
  };
}

export function join(id, userId) {
  const c = campaigns.get(id);
  if (!c) return { ok: false, error: 'الحملة غير موجودة.' };
  maybeExpire(c);
  if (c.status !== 'active') return { ok: false, error: 'الحملة اتقفلت.' };
  c.participants.add(userId);
  logger.info('انضمام لشراء جماعي', { campaignId: id, userId, total: c.participants.size });
  return { ok: true, state: getPublicState(id) };
}

export function listActive() {
  return [...campaigns.values()].map(c => { maybeExpire(c); return c; })
    .filter(c => c.status === 'active').map(c => getPublicState(c.id));
}

export default { createCampaign, join, getPublicState, listActive };
