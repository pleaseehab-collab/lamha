import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * طبقة إشراف ذكية اختيارية (AI Moderator) — بتنادي API خارجي لتصنيف
 * الرسالة قبل ما تتقرر (allow/warn/mute) لو AI_MODERATION_API_KEY متظبط.
 * لو مفيش مفتاح، بترجع null والنظام بيكتفي بالفلترة القائمة على القواعد
 * (badWords.js + spamGuard.js) الموجودة أصلاً في moderator.js — يعني
 * النظام يشتغل كامل من غيرها، وده Layer إضافي فوقه مش بديل عنه.
 *
 * الشكل هنا عام (endpoint + apiKey قابلين للتظبيط في .env) عشان تقدر
 * توصله بأي مزوّد moderation API تختاره، من غير ما تتقيد بواحد بعينه.
 */
export async function aiReview(text) {
  const { apiKey, endpoint } = env.aiModeration;
  if (!apiKey || !endpoint) return null;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: text })
    });
    if (!res.ok) throw new Error(`AI moderation HTTP ${res.status}`);
    const data = await res.json();
    // الشكل المتوقع من الـ endpoint: { flagged: boolean, categories: string[], severity: 'low'|'high' }
    return {
      flagged: !!data.flagged,
      categories: data.categories || [],
      severity: data.severity || 'low'
    };
  } catch (err) {
    logger.warn('فشل نداء AI moderation، هنكتفي بالفلترة القائمة على القواعد', { error: err.message });
    return null; // فشل الـ AI مبيوقفش الشات — بيرجع لفلترة القواعد العادية
  }
}

export default { aiReview };
