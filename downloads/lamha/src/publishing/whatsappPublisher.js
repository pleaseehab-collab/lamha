import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * إرسال عبر WhatsApp Cloud API (Meta). محتاج:
 *  - WHATSAPP_PHONE_NUMBER_ID
 *  - WHATSAPP_ACCESS_TOKEN
 *  - WHATSAPP_RECIPIENTS (أرقام مفصولة بفاصلة، بصيغة دولية بدون +)
 *
 * ⚠️ مهم قانونياً/سياسياً: واتساب مش زي تيليجرام — مينفعش تبعت رسائل نصية
 * حرة (freeform) لأرقام مالهاش "نافذة محادثة" مفتوحة (24 ساعة من آخر رسالة
 * منهم) إلا لو باستخدام "Message Template" متوافق عليه من ميتا مسبقاً.
 * الكود ده بيبعت رسالة نصية حرة — يشتغل بس لو النافذة مفتوحة، أو لازم
 * تستبدلها بقالب معتمد (type: "template") للنشر التسويقي الجماعي.
 */
export async function publishToWhatsapp(deal) {
  const { phoneNumberId, accessToken, recipients } = env.whatsapp;
  if (!phoneNumberId || !accessToken || recipients.length === 0) {
    return { ok: false, skipped: true, reason: 'إعدادات WhatsApp غير مكتملة.' };
  }

  const text = `${deal.title || 'عرض جديد'}${deal.price ? ` - ${deal.price}` : ''}\n${deal.link || ''}`;
  const endpoint = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const results = [];
  for (const to of recipients) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text }
        })
      });
      const data = await res.json();
      if (data.error) {
        logger.error('فشل إرسال واتساب', { to, error: data.error.message });
        results.push({ to, ok: false, error: data.error.message });
      } else {
        results.push({ to, ok: true, messageId: data.messages?.[0]?.id });
      }
    } catch (err) {
      results.push({ to, ok: false, error: err.message });
    }
  }
  return { ok: results.some(r => r.ok), results };
}

export default { publishToWhatsapp };
