#!/usr/bin/env node
/**
 * يولّد hash لكلمة سر لوحة /admin (scrypt) عشان تحطه في .env
 *   npm run admin:password                # بيولّد كلمة سر عشوائية قوية ويطبعها مرة واحدة
 *   npm run admin:password -- "كلمتك"     # أو تحدد كلمة السر بنفسك (8 أحرف+ وفيها حرف ورقم)
 */
import crypto from 'node:crypto';
import { hashPassword, isStrongEnough } from '../src/security/passwords.js';

const given = process.argv[2];
const password = given || crypto.randomBytes(12).toString('base64url') + '9a';
if (!isStrongEnough(password)) {
  console.error('كلمة السر ضعيفة: لازم 8 أحرف على الأقل وفيها حرف ورقم.');
  process.exit(1);
}
if (!given) console.log(`كلمة السر (احفظها دلوقتي، مش هتظهر تاني): ${password}\n`);
console.log('ضيف السطر ده في ملف .env:\n');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
