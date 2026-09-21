import { env } from '../config/env.js';
import * as ledger from './revenueLedger.js';
import * as userStore from '../users/userStore.js';
import { logger } from '../utils/logger.js';

/**
 * محرك تقاسم العمولات والشفافية.
 *
 * القاعدة: كل عمولة (grossCommission) بتتقسم 60/40 بين "المستخدم/البائع"
 * و"المنصة" — والنسبة قابلة للتعديل من متغيرات البيئة. لو فيه ريفيرال
 * (حد جاب المستخدم ده)، بياخد 10% إضافية بتتخصم من نصيب المنصة، مش من
 * نصيب البائع، عشان البائع دايماً يضمن نصيبه المتفق عليه (60% افتراضياً).
 *
 *   grossCommission = sellerShare + platformShare + referralShare
 *   sellerShare    = grossCommission * SELLER_PCT / 100
 *   referralShare  = referrerId ? grossCommission * REFERRAL_PCT / 100 : 0
 *   platformShare  = grossCommission - sellerShare - referralShare
 *
 * ⚠️ الشفافية: كل عملية بتتسجل في revenueLedger بكل الأرقام والنسب
 * المستخدمة وقت التنفيذ (snapshot)، عشان لو النسب اتغيرت بعدين، السجلات
 * القديمة تفضل موثّقة بالنسب اللي اتحسبت بيها فعلياً.
 *
 * ⚠️ Idempotency: نفس orderId مبيتعالجش مرتين. زي ما اتفقنا في نظام
 * الـ micro-shares القديم: لو حصل خطأ هنا، الأوردر نفسه ميتأثرش — بس
 * العمولة اللي مش هتتسجل صح، فلازم تتراجع/تتراقب من لوج الأخطاء.
 */

const SELLER_PCT = env.revenue.sellerSharePct; // افتراضي 60
const PLATFORM_PCT = env.revenue.platformSharePct; // افتراضي 40
const REFERRAL_PCT = env.revenue.referralSharePct; // افتراضي 10 (بتتخصم من نصيب المنصة)

export function splitRevenue({ orderId, grossCommission, sellerId, referrerId = null, source = 'affiliate' }) {
  try {
    if (!orderId || typeof orderId !== 'string') {
      throw new Error('orderId مطلوب (نص) لضمان الـ idempotency.');
    }
    // ⚠️ تصحيح ثغرة: Number.isFinite بيرفض NaN/Infinity، بعكس
    // "typeof x === 'number' && x <= 0" اللي كان بيسمح بمرور NaN لأن
    // (NaN <= 0) === false، فيبقى ممكن يعدي لو webhook مصاب ببَگ بيبعت
    // NaN كـ grossCommission بدون ما تتصفّى.
    if (!Number.isFinite(grossCommission) || grossCommission <= 0) {
      throw new Error('grossCommission لازم يكون رقم صالح أكبر من صفر.');
    }
    // ⚠️ حماية إضافية: عمولة أعلى من حد منطقي معرّف بالبيئة بترفض وتتسجل
    // كحدث أمني بدل ما تتنفذ على طول — يمنع استغلال تسريب سر الـ webhook
    // أو باگ في شريك خارجي من ضخ عمولات وهمية ضخمة.
    if (grossCommission > env.revenueLimits.maxCommissionEGP) {
      logger.error('عمولة واردة أعلى من الحد الأقصى المسموح — رُفضت للمراجعة اليدوية', {
        orderId, grossCommission, max: env.revenueLimits.maxCommissionEGP
      });
      throw new Error('grossCommission تجاوز الحد الأقصى المسموح به — تم الرفض للمراجعة.');
    }

    // ⚠️ نلف الفحص + التسجيل كله جوه قفل واحد (withLedgerLock) عشان
    // findByOrderId والـ append يحصلوا كوحدة ذرية واحدة. من غيره، لو
    // process تاني (Node cluster/PM2) خد نفس orderId في نفس اللحظة
    // بالظبط، الاتنين ممكن يعدّوا فحص findByOrderId قبل ما أي حد منهم
    // يسجّل، ويصرفوا نفس العمولة مرتين — وده بالظبط سيناريو "double
    // payout" اللي لازم يتمنع في أي نظام مالي.
    const outcome = ledger.withLedgerLock(() => {
      const existing = ledger.findByOrderId(orderId);
      if (existing) {
        return { duplicate: true, entry: existing };
      }

      // ⚠️ لو sellerId متبعت لازم يكون مستخدم حقيقي موجود فعلاً. من غير
      // الفحص ده، creditWallet كان يرجّع null بصمت (نصيب البائع يضيع)
      // وبرضو orderId يتسجل كـ "معالج" في الـ ledger فيبقى مستحيل نعيد
      // محاولة الصرف بعد ما نصلّح الـ sellerId الغلط — فلازم نرفض *قبل*
      // ما نسجّل في الـ ledger، عشان الطلب يفضل قابل لإعادة المحاولة.
      if (sellerId && !userStore.findById(sellerId)) {
        throw new Error(`sellerId غير موجود: ${sellerId} — تم رفض العملية قبل التسجيل عشان تبقى قابلة لإعادة المحاولة.`);
      }
      if (referrerId && !userStore.findById(referrerId)) {
        throw new Error(`referrerId غير موجود: ${referrerId} — تم رفض العملية قبل التسجيل عشان تبقى قابلة لإعادة المحاولة.`);
      }

      // ⚠️ الحساب بالقروش (أعداد صحيحة) بدل الجنيه (فاصلة عشرية) لتفادي
      // أخطاء تقريب الـ floating point (زي 0.1 + 0.2 !== 0.3 في JS) وضمان
      // "دقة بالقرش" المطلوبة صراحة.
      const grossQirsh = Math.round(grossCommission * 100);
      const sellerQirsh = Math.round((grossQirsh * SELLER_PCT) / 100);
      const referralQirsh = referrerId ? Math.round((grossQirsh * REFERRAL_PCT) / 100) : 0;
      // نصيب المنصة = الباقي دايماً (مش نسبة منفصلة محسوبة) عشان نضمن
      // sellerQirsh + referralQirsh + platformQirsh === grossQirsh بالظبط.
      const platformQirsh = grossQirsh - sellerQirsh - referralQirsh;

      const sellerShare = sellerQirsh / 100;
      const referralShare = referralQirsh / 100;
      const platformShare = platformQirsh / 100;

      const entry = ledger.append({
        orderId,
        source,
        grossCommission,
        sellerId: sellerId || null,
        referrerId: referrerId || null,
        sellerShare,
        referralShare,
        platformShare,
        splitSnapshot: { sellerPct: SELLER_PCT, platformPct: PLATFORM_PCT, referralPct: REFERRAL_PCT }
      });

      return { duplicate: false, entry, sellerShare, referralShare };
    });

    if (outcome.duplicate) {
      logger.info('عمولة اتعالجت قبل كده، تم تجاهل التكرار', { orderId });
      return { ok: true, duplicate: true, entry: outcome.entry };
    }

    // ⚠️ تحويلات المحفظة تحصل بعد الإفراج عن القفل عمداً (مش داخل fn) عشان
    // نمنع أي احتمال طويل من إمساك القفل، لكن ده معناه إن creditWallet
    // نفسها لسه معتمدة على نفس ضمانات userStore.js (شوف ملاحظة "Phase 1"
    // فيه) — تسجيل العمولة في الـ ledger هو مصدر الحقيقة (source of
    // truth) وقابل لإعادة تسوية الأرصدة منه لو حصل تعارض في المحفظة.
    if (sellerId && outcome.sellerShare > 0) {
      userStore.creditWallet(sellerId, outcome.sellerShare, `commission:${orderId}`);
    }
    if (referrerId && outcome.referralShare > 0) {
      userStore.creditWallet(referrerId, outcome.referralShare, `referral:${orderId}`);
    }

    logger.info('تقسيم عمولة جديد', {
      orderId, sellerShare: outcome.sellerShare, referralShare: outcome.referralShare
    });
    return { ok: true, duplicate: false, entry: outcome.entry };
  } catch (err) {
    // مهم: أبداً منرمي الخطأ لفوق — نفس فلسفة processCommission القديمة:
    // فشل تسجيل العمولة ميوقفش أي عملية تانية (زي إتمام الطلب نفسه).
    logger.error('فشل تقسيم عمولة', { orderId, error: err.message });
    return { ok: false, error: err.message };
  }
}

export default { splitRevenue };
