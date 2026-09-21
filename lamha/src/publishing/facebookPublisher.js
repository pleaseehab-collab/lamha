import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * نشر على صفحة فيسبوك عبر Graph API. محتاج:
 *  - FACEBOOK_PAGE_ID
 *  - FACEBOOK_PAGE_ACCESS_TOKEN (Page Access Token طويل الأمد، مش user token)
 * لازم الـ App يكون معدّى مراجعة فيسبوك (App Review) للصلاحية pages_manage_posts
 * قبل ما يشتغل في الإنتاج على صفحات مش تابعة لحساب المطوّر نفسه.
 */
export async function publishToFacebook(deal) {
  const { pageId, pageAccessToken } = env.facebook;
  if (!pageId || !pageAccessToken) {
    return { ok: false, skipped: true, reason: 'FACEBOOK_PAGE_ID/FACEBOOK_PAGE_ACCESS_TOKEN غير مضبوطين.' };
  }

  const message = `${deal.title || 'عرض جديد'}${deal.price ? `\nالسعر: ${deal.price}` : ''}\n${deal.link || ''}`;
  const endpoint = `https://graph.facebook.com/v19.0/${pageId}/feed`;

  try {
    const params = new URLSearchParams({ message, access_token: pageAccessToken });
    if (deal.link) params.set('link', deal.link);

    const res = await fetch(endpoint, { method: 'POST', body: params });
    const data = await res.json();
    if (data.error) {
      logger.error('فشل نشر فيسبوك', { error: data.error.message });
      return { ok: false, error: data.error.message };
    }
    return { ok: true, postId: data.id };
  } catch (err) {
    logger.error('استثناء أثناء نشر فيسبوك', { error: err.message });
    return { ok: false, error: err.message };
  }
}

export default { publishToFacebook };
