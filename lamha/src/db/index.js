import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

/**
 * Database facade — طبقة تجريد موحدة للتخزين (key-value collections).
 *
 * الهدف: باقي الكود (pointsSystem، اللوبيات، إلخ) يتعامل مع واجهة واحدة
 * ثابتة، والـ driver تحت هو اللي يتبدّل (memory / file / وبعدين Redis أو
 * Postgres) من غير ما تغيّر في أي مكان بيستخدمها.
 *
 * الـ drivers المتاحة:
 *   - memory : للاختبارات (DB_DRIVER=memory)
 *   - file   : JSON على القرص بكتابة ذرّية (atomic) ومؤجلة (debounced) — الافتراضي
 *
 * الواجهة متزامنة (sync) عن قصد عشان الـ engines تفضل بسيطة. لو هتنقل
 * لـ Postgres/Redis اعمل driver جديد بنفس الـ interface (load/persist)
 * وخلّي الـ facade يحتفظ بكاش في الذاكرة (write-through).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = (process.env.DB_DRIVER || 'file').toLowerCase();
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'lamha-db.json');
const FLUSH_DELAY_MS = 250;

/** @type {Record<string, Record<string, any>>} */
let data = {};
let dirty = false;
let timer = null;

const drivers = {
  memory: {
    load: () => ({}),
    persist: () => {}
  },
  file: {
    load() {
      try {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') logger.warn('تعذّر قراءة ملف قاعدة البيانات، هنبدأ من فاضي', { message: err.message });
        return {};
      }
    },
    persist(snapshot) {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
      const tmp = `${DB_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
      fs.renameSync(tmp, DB_FILE); // rename ذرّي: مفيش ملف نص مكتوب لو السيرفر وقع
    }
  }
};

const driver = drivers[DRIVER] || drivers.file;
data = driver.load();

function markDirty() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(flush, FLUSH_DELAY_MS);
  timer.unref?.();
}

export function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    driver.persist(data);
  } catch (err) {
    dirty = true;
    logger.error('فشل حفظ قاعدة البيانات', { message: err.message });
  }
}

process.on('exit', flush);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    flush();
    process.exit(0);
  });
}

/**
 * @param {string} name
 */
export function collection(name) {
  if (!data[name]) data[name] = {};
  const bucket = () => data[name];
  return {
    get: key => (key in bucket() ? bucket()[key] : undefined),
    has: key => key in bucket(),
    set(key, value) {
      bucket()[key] = value;
      markDirty();
      return value;
    },
    /** تعديل قيمة موجودة بدالة (read-modify-write في خطوة واحدة) */
    update(key, fn, fallback) {
      const next = fn(key in bucket() ? bucket()[key] : fallback);
      bucket()[key] = next;
      markDirty();
      return next;
    },
    delete(key) {
      const existed = key in bucket();
      delete bucket()[key];
      if (existed) markDirty();
      return existed;
    },
    entries: () => Object.entries(bucket()),
    values: () => Object.values(bucket()),
    keys: () => Object.keys(bucket()),
    get size() {
      return Object.keys(bucket()).length;
    },
    clear() {
      data[name] = {};
      markDirty();
    }
  };
}

export const dbInfo = { driver: driver === drivers.memory ? 'memory' : 'file', file: DB_FILE };

export default { collection, flush, dbInfo };
