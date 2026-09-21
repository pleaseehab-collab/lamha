import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORDLIST_FILE = fileURLToPath(new URL('./badwords.ar-eg.json', import.meta.url));
const wordlist = JSON.parse(readFileSync(WORDLIST_FILE, 'utf8'));

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g; // ـــ (elongation)

/**
 * تطبيع نص عربي مصري: بيشيل التشكيل والتطويل، ويوحّد أشكال الحروف المتشابهة
 * (أ/إ/آ -> ا، ى -> ي، ة -> ه)، ويشيل التكرار الزيادة (كسمممك -> كسمك)،
 * ويشيل المسافات/الرموز بين الحروف اللي بتتحط للتحايل على الفلتر (ك س م ك).
 */
export function normalizeArabic(text) {
  if (!text) return '';
  let t = text;
  t = t.replace(ARABIC_DIACRITICS, '').replace(TATWEEL, '');
  t = t.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  // شيل أي رمز/مسافة/نقطة متكررة بين الحروف العربية (محاولة تحايل شائعة)
  t = t.replace(/([\u0600-\u06FF])[\s._*\-]+(?=[\u0600-\u06FF])/g, '$1');
  // اختزال تكرار نفس الحرف أكتر من مرتين (كسمممك -> كسمك)
  t = t.replace(/(.)\1{2,}/g, '$1$1');
  t = t.toLowerCase().trim().replace(/\s+/g, ' ');
  return t;
}

function buildMatcher(words) {
  return words.map(w => normalizeArabic(w)).filter(Boolean);
}

const severeList = buildMatcher(wordlist.severe || []);
const moderateList = buildMatcher(wordlist.moderate || []);
const harassmentList = buildMatcher(wordlist.harassment_patterns || []);

/**
 * يفحص نص ويرجّع أعلى مستوى مخالفة موجود فيه، لو في حاجة أصلاً.
 * @returns {{severity: 'none'|'moderate'|'severe'|'harassment', matched: string[]}}
 */
export function scanProfanity(rawText) {
  const norm = normalizeArabic(rawText);
  if (!norm) return { severity: 'none', matched: [] };

  const hits = { severe: [], moderate: [], harassment: [] };
  for (const w of severeList) if (w && norm.includes(w)) hits.severe.push(w);
  for (const w of moderateList) if (w && norm.includes(w)) hits.moderate.push(w);
  for (const w of harassmentList) if (w && norm.includes(w)) hits.harassment.push(w);

  if (hits.severe.length) return { severity: 'severe', matched: hits.severe };
  if (hits.harassment.length) return { severity: 'harassment', matched: hits.harassment };
  if (hits.moderate.length) return { severity: 'moderate', matched: hits.moderate };
  return { severity: 'none', matched: [] };
}

export default { normalizeArabic, scanProfanity };
