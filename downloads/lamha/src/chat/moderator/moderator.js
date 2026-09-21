import { scanProfanity } from './badWords.js';
import { checkSpam } from './spamGuard.js';
import * as muteManager from './muteManager.js';
import { aiReview } from './aiModerator.js';

/**
 * "المشرف الذكي" — بيراجع كل رسالة قبل ما توصل لباقي الغرفة، ويرجّع قرار واحد
 * واضح يقدر الـ socket handler يتصرف عليه فوراً.
 *
 * القرارات الممكنة:
 *  - allow:   الرسالة تمام، تتبعت للغرفة
 *  - warn:    الرسالة اتبعتت بس مع تحذير راجع للمستخدم بس (مخالفة بسيطة/سبام)
 *  - mute:    مخالفة تستاهل كتم مؤقت — الرسالة مش بتتبعت، وبيتفعّل الكتم
 *  - blocked: المستخدم مكتوم أصلاً من قبل، مينفعش يبعت لحد ما ينتهي الكتم
 */
export async function reviewMessage({ userId, text, siteHost }) {
  if (muteManager.isMuted(userId)) {
    return {
      action: 'blocked',
      reason: 'muted',
      muteRemainingSeconds: muteManager.muteRemainingSeconds(userId)
    };
  }

  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { action: 'blocked', reason: 'empty' };
  }
  if (trimmed.length > 500) {
    return { action: 'blocked', reason: 'too_long' };
  }

  // طبقة الذكاء الاصطناعي (اختيارية، فوق القواعد الأساسية مش بدل منها) —
  // لو مفيش مفتاح API متظبط في .env بترجع null وبنكمل بالفلترة العادية.
  const ai = await aiReview(trimmed);
  if (ai?.flagged && ai.severity === 'high') {
    const mute = muteManager.strikeAndMute(userId);
    return { action: 'mute', reason: 'ai_flagged', categories: ai.categories, mute };
  }

  const profanity = scanProfanity(trimmed);

  if (profanity.severity === 'severe') {
    const mute = muteManager.strikeAndMute(userId);
    return { action: 'mute', reason: 'severe_language', mute };
  }

  if (profanity.severity === 'harassment') {
    const mute = muteManager.strikeAndMute(userId);
    return { action: 'mute', reason: 'harassment', mute };
  }

  const spam = checkSpam(userId, trimmed, { siteHost });

  if (spam.reasons.includes('external_link') || spam.reasons.includes('external_invite')) {
    const mute = muteManager.strikeAndMute(userId);
    return { action: 'mute', reason: 'external_link', mute, details: spam.reasons };
  }

  if (profanity.severity === 'moderate') {
    // مخالفة أخف — إنذار وكتم قصير من غير ما نوصل لأقصى تصعيد فوراً
    const mute = muteManager.strikeAndMute(userId, { severityOverrideSeconds: 60 });
    return { action: 'mute', reason: 'mild_language', mute };
  }

  if (spam.isSpam) {
    return { action: 'warn', reason: 'spam_pattern', details: spam.reasons };
  }

  return { action: 'allow' };
}

export default { reviewMessage };
