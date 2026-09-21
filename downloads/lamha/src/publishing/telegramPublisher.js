import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * نشر حقيقي على تيليجرام عبر Bot API — شغّال فعلياً لو TELEGRAM_BOT_TOKEN
 * و TELEGRAM_CHAT_ID متظبطين في .env (استخدم @BotFather لعمل بوت،
 * و @userinfobot أو getUpdates لمعرفة chat_id القناة/الجروب).
 */
export async function publishToTelegram(deal) {
  const { botToken, chatId } = env.telegram;
  if (!botToken || !chatId) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID غير مضبوطين.' };
  }

  const caption = formatCaption(deal);
  const endpoint = deal.image
    ? `https://api.telegram.org/bot${botToken}/sendPhoto`
    : `https://api.telegram.org/bot${botToken}/sendMessage`;

  const body = deal.image
    ? { chat_id: chatId, photo: deal.image, caption, parse_mode: 'HTML' }
    : { chat_id: chatId, text: caption, parse_mode: 'HTML', disable_web_page_preview: false };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      logger.error('فشل نشر تيليجرام', { description: data.description });
      return { ok: false, error: data.description };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    logger.error('استثناء أثناء نشر تيليجرام', { error: err.message });
    return { ok: false, error: err.message };
  }
}

function formatCaption(deal) {
  const price = deal.price ? `\n💰 <b>${deal.price}</b>` : '';
  const link = deal.link ? `\n🔗 ${deal.link}` : '';
  return `🔥 <b>${escapeHtml(deal.title || 'عرض جديد')}</b>${price}${link}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default { publishToTelegram };
