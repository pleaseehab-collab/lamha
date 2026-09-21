# لمحة (Lamha) — سيرفر Node.js/Express

هيكلية سيرفر كاملة لتطبيق **Affiliate Hub + مجتمع تفاعلي** لأسواق Amazon Egypt، Temu، وAliExpress، مبنية فوق الهيكل الأساسي اللي كان موجود (`shop.html`, `deals.json`, `update-deals.mjs`).

> ⚠️ **مهم قبل الإنتاج:** الأقسام اللي بتخزّن بيانات (الكتم، السبام، اللوبيات، النقط، مكافحة الاحتيال) شغّالة حالياً في **الذاكرة (in-memory)** فقط — Phase 1. لازم تتنقل لـ Redis/PostgreSQL قبل ما تشغّل السيرفر بأكتر من نسخة (instance) أو تعتمد عليه في الإنتاج، لأن أي `restart` بيصفّر كل حاجة، وأي نسختين شغالين مع بعض مش هيتزامنوا.

## التشغيل

```bash
npm install
cp .env.example .env   # واملأ التاجات الحقيقية بتاعتك (Amazon/AliExpress/Temu)
npm run dev             # أو npm start للإنتاج
```

السيرفر بيشتغل على `http://localhost:3000` (أو `PORT` اللي في `.env`)، وبيسيرف `public/shop.html` كصفحة رئيسية.

## هيكل المشروع

```
lamha/
├── src/
│   ├── index.js                 # نقطة الدخول: Express + HTTP server + Socket.io
│   ├── config/env.js             # كل متغيرات البيئة في مكان واحد
│   ├── data/deals.json           # نفس ملف العروض الأصلي
│   ├── routes/                   # REST APIs (deals, affiliate, health)
│   ├── affiliate/                # 1) محرك روابط الأفيليت
│   │   ├── affiliateEngine.js    #    نقطة الدخول: يكتشف المتجر ويحوّل
│   │   ├── urlUtils.js           #    تنظيف باراميترات التتبع
│   │   └── stores/               #    محوّل مخصص لكل متجر (amazon/temu/aliexpress)
│   ├── chat/                     # 2) الشات والمجتمع (Socket.io)
│   │   ├── socket.js             #    غرف، حضور، رسائل، ربط كل حاجة ببعض
│   │   ├── roomsConfig.js        #    تعريف الغرف
│   │   ├── dealAssistant.js      #    مساعد العروض الذكي (بيقرأ من deals.json)
│   │   ├── chatRateLimiter.js    #    حد أقصى رسائل لكل مستخدم
│   │   └── moderator/            #    المشرف الذكي
│   │       ├── badWords.js       #      تطبيع نص عربي + كشف الألفاظ
│   │       ├── badwords.ar-eg.json #    قائمة بداية (starter list) — كمّلها بنفسك
│   │       ├── spamGuard.js      #      روابط خارجية / سبام / تكرار
│   │       ├── muteManager.js    #      الكتم المؤقت المتصاعد (escalation)
│   │       └── moderator.js      #      يجمع كل حاجة فوق في قرار واحد
│   ├── security/                 # 3) الحماية والأمان
│   │   ├── rateLimiter.js        #    express-rate-limit لكل الـ HTTP APIs
│   │   ├── antiFraud.js          #    كشف نقرات البوتات على روابط الأفيليت
│   │   └── helmetConfig.js       #    هيدرز أمان + CSP
│   └── games/                    # 4) الألعاب الجماعية
│       ├── lobbyManager.js       #    غرف انتظار عامة لأي لعبة دور-بدور
│       ├── pointsSystem.js       #    نقط + كوبونات مشتركة بين الألعاب
│       ├── gamesSocket.js        #    أحداث Socket.io بتاعة الألعاب
│       ├── games.routes.js       #    REST: رصيد النقط، الكوبونات، حالة العجلة
│       └── engines/
│           ├── wheel.js          #    عجلة الحظ — شغّالة بالكامل ✅
│           ├── ludo.js           #    الليدو — بنية تحتية (Phase 1) 🚧
│           ├── domino.js         #    الدومينو — بنية تحتية (Phase 1) 🚧
│           └── uno.js            #    أونو — بنية تحتية (Phase 1) 🚧
├── public/shop.html              # نفس الواجهة الأصلية (بتاخد العروض من /api/deals دلوقتي)
├── update-deals.mjs              # نفس سكريبت التحديث اليومي (اتعدّل المسار بس)
└── .env.example
```

## 1) محرك روابط الأفيليت

```
POST /api/affiliate/convert          body: { "url": "https://amazon.eg/dp/XXXXXXXXXX" }
POST /api/affiliate/convert-batch    body: { "urls": [...] }
GET  /api/go?url=<encoded>&pid=<id>  إعادة توجيه بعد فحص مكافحة الاحتيال
```

- **Amazon**: بيستخرج الـ ASIN من أي شكل رابط (`/dp/`, `/gp/product/`, ...)، بيعيد بناء رابط نضيف، وبيضيف `?tag=` من `AMAZON_EG_TAG`.
- **AliExpress**: لو الرابط مختصر (`s.click.aliexpress.com`) بيسيبه زي ما هو، غير كده بيستخرج `productId` وبيبني رابط أفيليت بـ `aff_trace_key`. للحصول على رابط مختصر رسمي (`generatePromotionLink`) لازم تفعّل `ALIEXPRESS_APP_KEY/SECRET` وتكمّل `generateShortLinkViaApi()` في `stores/aliexpress.js` حسب [توثيق AliExpress Affiliate API](https://open.aliexpress.com).
- **Temu**: بيسيب الروابط المختصرة الجاهزة (`temu.to/...`) وبيضيف `aff_id` للروابط العادية — تيمو مفيهاش API عام موحّد زي التانيين، فالموصى بيه تستخدم الروابط الجاهزة من لوحة الأفيليت مباشرة.

## 2) الشات والمجتمع

Socket.io namespace: **`/chat`**

| الحدث (من الكلاينت) | الوصف |
|---|---|
| `chat:join` (roomId) | ينضم لغرفة (electronics, phones, home, fashion, beauty, general, deals-hunters, games-lobby) |
| `chat:message` (text) | يبعت رسالة |
| `chat:typing` | إشعار "بيكتب دلوقتي" |

| الحدث (من السيرفر) | الوصف |
|---|---|
| `chat:message` | رسالة جديدة (من مستخدم أو من البوت `lamha-bot`) |
| `chat:muted` | تم كتمك، مع السبب والمدة |
| `chat:error` | خطأ (Rate limit، غرفة مش موجودة، متكتم...) |
| `chat:presence` | عدد المتصلين في الغرفة |

**المشرف الذكي (AI Moderator)** بيفحص كل رسالة (`moderator/moderator.js`) بالترتيب: هل المستخدم متكتم؟ → ألفاظ خاطئة (بعد تطبيع اللهجة المصرية) → روابط خارجية/سبام → تكرار. أي مخالفة بتستدعي `muteManager` اللي بيطبّق **كتم مؤقت متصاعد** (المرة الأولى مدة قصيرة، وبتكبر مع كل مخالفة جديدة). قائمة الألفاظ في `badwords.ar-eg.json` هي **قائمة بداية فقط وغير شاملة** — لازم تراجعها وتزوّد عليها حسب مجتمعك.

**مساعد العروض الذكي**: لو حد كتب "عايز عروض موبايلات" أو "/deals" أو "في خصم كوتشيات"، `dealAssistant.js` بيدوّر في `deals.json` (نفس منطق الكلمات المفتاحية المستخدم في `shop.html`) ويرد كرسالة بوت في نفس الغرفة بأقوى 3 عروض مطابقة مع روابط `/api/go` جاهزة.

## 3) الحماية والأمان

- **Rate limiting**: `express-rate-limit` على كل الـ APIs، وأشد على `/api/affiliate/convert` و `/api/go`. رسائل الشات ليها Limiter منفصل (`chatRateLimiter.js`).
- **مكافحة الاحتيال (`antiFraud.js`)**: بيبني "بصمة" (fingerprint) لكل زائر من الـ IP + User-Agent + Device ID اختياري، ويرصد: نقرات كتير في وقت قصير، أو User-Agent بتاع بوت معروف (curl, headless browsers...). النقرة المشبوهة بتتوجّه لرابط المنتج **العادي** (من غير تاج الأفيليت) بدل ما تتمنع تماماً — كده بنحمي حساب الأفيليت من نشاط وهمي من غير ما نمنع مستخدم حقيقي بالخطأ.
- **Helmet + CSP** مضبوطين يسمحوا بصور المنتجات الخارجية (Unsplash وغيرها) لكن يمنعوا سكريبتات غير موثوقة.

## 4) الألعاب الجماعية

Socket.io namespace: **`/games`**

- **عجلة الحظ (`wheel.js`)**: لعبة فردية فورية شغّالة بالكامل — جوائز موزونة عشوائياً (weighted random)، حد أقصى دورة كل 24 ساعة لكل مستخدم، بتضيف نقط عن طريق `pointsSystem.js` اللي بيصدر كوبونات خصم تلقائياً عند الوصول لعتبات معينة.
  - الحدث: `wheel:spin` → `wheel:result`
- **الليدو / الدومينو / أونو**: البنية التحتية جاهزة بالكامل (لوبي/غرفة انتظار، توزيع أوراق/قطع، دور اللاعبين، حالة اللعبة) عن طريق `lobbyManager.js` وواجهة موحّدة لكل لعبة (`meta`, `createInitialState`, `applyMove`). قواعد اللعب التفصيلية (تحقق النقلات، كروت الأكشن في أونو، ضرب المهرات في الليدو...) متعلّمة بـ `TODO` في كل ملف عشان تكملها من غير ما تلمس نظام اللوبي.
  - الأحداث: `games:list`, `games:create`, `games:join`, `games:leave`, `games:start`, `games:move` → `games:lobby` / `games:state` / `games:error`

## خطوات لازمة قبل الإنتاج

1. اربط كل من `adapters.amazon/aliexpress/temu` في `update-deals.mjs` بمصادر الأسعار الرسمية.
2. فعّل `ALIEXPRESS_APP_KEY/SECRET` وكمّل `generateShortLinkViaApi`.
3. كمّل قائمة `badwords.ar-eg.json`، وفكّر في إضافة نموذج ML/خدمة خارجية لفلترة أدق لو المجتمع كبر.
4. انقل الحالة في الذاكرة (mute، سبام، لوبيات، نقط، مكافحة الاحتيال) لـ Redis/DB.
5. حط نظام مصادقة حقيقي (JWT مثلاً) بدل الـ `userId` المؤقت اللي بيتبعت من الكلاينت.
6. كمّل منطق الليدو/الدومينو/أونو التفصيلي في `src/games/engines/`.

---

## 🎱 الألعاب الجديدة + طبقة قاعدة البيانات (Final Audited)

**8-Ball Pool** (`src/games/engines/pool.js`) — فيزياء وقواعد كاملة في السيرفر (server-authoritative). العميل بيبعت نيّة بس:

| Socket event (namespace `/games`) | Payload | ملاحظات |
|---|---|---|
| `pool:place_cue` | `{ x, y }` | لما يكون في ball-in-hand (الكسر: قبل خط الرأس فقط) |
| `pool:shoot` | `{ angle, power }` | angle بالراديان، power 0..1 |
| `ludo:roll` / `ludo:move` | — / `{ pieceIndex }` | نفس `games:move` بس بأسماء مخصصة |

السيرفر بيرجّع `pool:shot_result` (فيه `frames` بمعدل 20fps للأنيميشن) ثم `games:state` بالحالة النهائية. أبعاد الطاولة والجيوب موجودة في `state.table`. القواعد: طاولة مفتوحة → تحديد المجموعات، فاول (بيضا في جيب / مفيش احتكاك / كورة غلط / مفيش جانب / كسر غير قانوني) = ball-in-hand للخصم، السودا (خسارة مبكرة / فوز بعد تخليص المجموعة / re-rack في الكسر). **من غير تسمية جيب** (no called pocket).

**الليدو** (`ludo.js`) — محرك كامل: 6 للخروج، أكل، مربعات آمنة، طريق البيت، رقم مظبوط للنهاية، دور إضافي، 3 سكستات = ضياع الدور. النرد `crypto.randomInt` في السيرفر.

**Database facade** (`src/db/index.js`) — واجهة `collection(name)` (get/set/update/delete/values…) بـ driver `file` (كتابة ذرّية) أو `memory` (`DB_DRIVER`). `pointsSystem` و`userStore` شغّالين عليها، فالنقاط والمستخدمين بيفضلوا بعد الـ restart. **ملاحظة:** `revenueLedger` لسه بيستخدم ملفه الخاص بنظام القفل بتاعه ولم يتم ترحيله.

**النقاط:** المكافأة (فوز 50 / مشاركة 5) بتتحسب في السيرفر مرة واحدة لكل لعبة وتتبعت لصاحبها بس على `games:rewards`. الضيوف (`guest_*`) مبياخدوش نقاط.

**الاختبارات:** `npm test` (29 اختبار: بلياردو، ليدو، نقاط، استمرارية البيانات بعد restart، تكامل اللوبي، وتحقق أونو/دومينو).

### 🚀 تشغيل سريع
```bash
npm install
npm start          # ملف .env الجاهز للتطوير موجود (مفاتيح عشوائية)
npm test           # 48 اختبار
```
قبل الإنتاج: `NODE_ENV=production` + مفاتيح جديدة (`openssl rand -hex 32`) + `ADMIN_IP_WHITELIST`.

### 🧭 الـ REST endpoints الجديدة/المضافة
`GET /api/games/catalog` · `GET /api/games/lobbies?type=pool` · `POST /api/games/wheel/spin` (JWT) ·
`GET /api/groupbuy/:id` · `GET /api/coupons/marketplace/:id` · `POST /api/assistant` · `GET /api/health`

---

## 🔐 الأمان والخصوصية (الإصدار الأخير)

- **نقطة التشغيل:** `server.js` (Express + Socket.io على `/chat` و`/games` و`/auctions`). `src/index.js` بقى مجرد توافق.
- **لوحة `/admin`:** كلمة سر (scrypt hash في `ADMIN_PASSWORD_HASH`، ولّدها بـ `npm run admin:password`) + جلسة موقّعة HttpOnly/SameSite=Strict لمدة 30 دقيقة + حماية CSRF بهيدر + قفل 15 دقيقة بعد 5 محاولات دخول غلط أو 3 محاولات تعديل غير مصرح بها + سجل Audit. من غير الـ hash اللوحة مقفولة بالكامل، وفي production السيرفر يرفض الإقلاع من غيره.
- **زر "أعلن معنا":** `GET /api/ads/contact` → تحويل 302 من السيرفر لواتساب. الرقم في `ADS_WHATSAPP_NUMBER` داخل `.env` فقط، ومفيش أي رقم في الصفحات أو الكود (اختبار آلي بيتأكد). ⚠️ واتساب نفسه بيعرض الرقم لمن يفتح المحادثة؛ استخدم رقم Business مخصص للإعلانات.
- **الخصوصية:** هيدر `Permissions-Policy` بيعطّل الموقع الجغرافي والكاميرا والميكروفون وباقي الحساسات؛ لا كود في الموقع بيطلب GPS. ⚠️ ده بيمنع واجهة المتصفح فقط، والموقع التقريبي من عنوان IP خارج نطاق أي موقع.
- **إخفاء التقنية:** `X-Powered-By`/`Server` محذوفة، `/health` بترجّع `{ok:true}` فقط، رسائل الأخطاء عامة (التفاصيل في اللوج فقط)، وHSTS/COOP بيشتغلوا في production فقط.

## 🎮 الألعاب
`/ludo.html` — لودو متعدد اللاعبين (2–4) على Socket.io (`/games`)، زر "🎮 الألعاب" في هيدر المتجر. الدومينو/أونو/بلياردو/عجلة الحظ engines جاهزة في السيرفر لكن مفيش لها واجهة بعد.

## 🤖 تحديث العروض والذكاء الاصطناعي
`update-deals.mjs` والسيرفر بيستخدموا نفس المحرك (`src/deals/`): جلب من feeds رسمية (`DEALS_FEED_*_URL`) بشرط HTTPS ودومين المتجر نفسه، تحويل لروابط أفيليت، تصنيف بالكلمات المفتاحية + AI اختياري (`AI_API_KEY`، والمخرجات بتتفحص بصرامة)، ونشر تلقائي (`DEALS_AUTO_PUBLISH`). تشغيل يومي: `DEALS_AUTO_UPDATE=true`، أو يدوياً من `/admin`، أو `npm run update-deals`.
