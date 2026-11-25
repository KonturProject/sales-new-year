/**
 * Бэкенд «Новогодней площади»: Google Apps Script + Google Sheets.
 * Хранит только факты (оплаты, воронку, штат, отсутствия, покупки, правки); монеты, ёлку и домики считает страница.
 * GET отдаёт снимок по ключу экрана, запись идёт POST-запросами с PIN в теле (JSON как text/plain).
 * Развёртывание и PIN — apps-script/README.md. Тесты гоняют этот же файл: apps-script/test/.
 *
 * Ответ POST: { ok: true, … } или { ok: false, error: 'invalid_pin' | 'locked' | 'bad_request' | 'finished' | 'server_error' }.
 * Все ячейки текстовые ('@'): иначе таблица превратит «2026-11-03» в дату, а номер счёта «000123» в число.
 */

const GROUPS = ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'];
const LEVELS = ['experienced', 'rookie1', 'rookie2'];
const ABSENCE_KINDS = ['vacation', 'sick', 'other'];
const TIME_ZONE = 'Europe/Moscow';
const MAX_PIN_FAILURES = 5;
const PIN_BLOCK_SEC = 600;
const MAX_IMPORT_DAYS = 62;
const MAX_COUNT = 10000;
const PIN_FORMAT = /^\d{4,12}$/;
const HIDDEN_REASON_MAX = 200;

/** Правок «с даты» (configChanges) не больше: ячейка листа не безразмерна. */
const CONFIG_CHANGES_MAX = 30;
/** Личные нормы по уровню: воронка за день и оплат в день (дробные, до сотых). */
const NORM_FIELDS = ['quality', 'long', 'payments'];
const NORM_MAX = 50;
const REF_MAX = 64;
const REASON_MAX = 200;
/** Коды товаров по магазинам (каталог клиента `src/engine/catalog.ts`); у ёлки ещё место 1..TREE_SLOTS. */
const SHOPS = { tree: [1, 30], gift: [101, 103], attic: [201, 213], cellar: [301, 313] };
const TREE_SLOTS = 66;
const MAX_BUYS_PER_DAY = 40;
/** Платёжки РГ: сколько может стоять за день и сколько раз в день можно нажать. */
const MAX_PAYMENTS_PER_DAY = 15;
const MAX_PAYMENT_CLICKS = 40;
const CURRENCIES = ['coins', 'flakes', 'keys'];
const GRANT_MAX = 500;
const GRINCH_KINDS = ['steal', 'garland', 'return'];
const GRINCH_COMMANDS_KEPT = 20;
const QUIET_MIN = 30;
const QUIET_MAX = 480;
const SCREEN_KINDS = ['replay', 'salute', 'opening', 'snowball', 'finale'];
const SCREEN_COMMANDS_KEPT = 10;
const SCREEN_COMMAND_SEC = 600;
/** Период игры (включительно): правки фактов и выходные только внутри него. */
const GAME_START = '2026-12-01';
const GAME_END = '2026-12-30';
const NON_WORKING_MAX = 29;
/** Ручные правки фактов: показатель, дельта (целая, не 0), записей в запросе и всего. */
const CORRECTION_KINDS = ['quality', 'long', 'payments'];
const CORRECTION_DELTA_MAX = 50;
const CORRECTION_ITEMS_MAX = 3;
const CORRECTIONS_MAX = 2000;

/** Листы и колонки; первая строка — заголовок, данные с второй. */
const SHEETS = {
  Payments: ['date', 'group', 'author', 'invoice'],
  Provisional: ['date', 'group', 'count'],
  Funnel: ['employeeId', 'date', 'quality', 'long'],
  Staff: ['id', 'name', 'shortName', 'group', 'hireDate', 'fireDate', 'baseLevel', 'hiddenFromRating', 'transfers', 'hiddenReason', 'paymentPlan'],
  Absences: ['employeeId', 'kind', 'from', 'to'],
  PaymentLog: ['id', 'at', 'date', 'group', 'delta', 'source', 'ref'],
  Purchases: ['id', 'at', 'date', 'group', 'shop', 'item', 'slot', 'employeeId', 'ref', 'cancelledAt', 'reason'],
  Grants: ['id', 'date', 'group', 'kind', 'delta', 'reason', 'ref'],
  Corrections: ['id', 'date', 'employeeId', 'kind', 'delta', 'base', 'ref'],
  Settings: ['key', 'value'],
};

// ---------------------------------------------------------------- общие помощники

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Ошибка во входных данных: doPost превращает её в bad_request. */
function fail_() {
  const err = new Error('bad_request');
  err.badRequest = true;
  throw err;
}

function compare_(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function isGroup_(v) {
  return typeof v === 'string' && GROUPS.indexOf(v) >= 0;
}

function isCount_(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT;
}

function isIntIn_(v, min, max) {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** Личная норма (quality, long, payments): 0…NORM_MAX, не больше двух знаков после запятой (так же проверяет клиент). */
function isNorm_(v) {
  return typeof v === 'number' && v >= 0 && v <= NORM_MAX && Math.round(v * 100) / 100 === v;
}

function isPlainObject_(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Так же, как normalizeName на странице: обрезать, схлопнуть пробелы, нижний регистр, «ё» как «е». */
function normalizeName_(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

/** Момент записи: ISO по Москве. */
function now_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss'+03:00'");
}

function today_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
}

function daysInclusive_(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
}

// ---------------------------------------------------------------- таблицы

/** Таблица открывается один раз на запрос: doGet и doPost сбрасывают её в начале. */
let spreadsheetMemo_ = null;

function spreadsheet_() {
  if (spreadsheetMemo_) return spreadsheetMemo_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  spreadsheetMemo_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheetMemo_;
}

/** Лист для записи: создаётся с заголовком при первой записи. */
function sheetFor_(name) {
  const ss = spreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, SHEETS[name].length).setNumberFormat('@').setValues([SHEETS[name]]);
    sheet.setFrozenRows(1);
  } else {
    // лист создан до нового столбца (Staff.paymentPlan): добавляем столбцы и дописываем заголовок
    const width = SHEETS[name].length;
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    if (sheet.getRange(1, width).getValues()[0][0] === '') sheet.getRange(1, 1, 1, width).setNumberFormat('@').setValues([SHEETS[name]]);
  }
  return sheet;
}

function cellText_(v, tz) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v);
}

/** Строки данных листа как массивы строк; чтение не создаёт листов, пустые строки пропускаются. */
function readRows_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) return [];
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const tz = spreadsheet_().getSpreadsheetTimeZone();
  const width = SHEETS[name].length;
  // у листа, созданного до нового столбца, столбцов может не хватать: недостающие читаются пустыми
  return sheet
    .getRange(2, 1, last - 1, Math.min(width, sheet.getMaxColumns()))
    .getValues()
    .map(function (row) {
      const out = row.map(function (v) {
        return cellText_(v, tz);
      });
      while (out.length < width) out.push('');
      return out;
    })
    .filter(function (row) {
      return row.some(function (v) {
        return v !== '';
      });
    });
}

/** Заменяет все строки данных листа одним setValues; хвост старых строк очищается после записи. */
function writeRows_(name, rows) {
  const sheet = sheetFor_(name);
  const width = SHEETS[name].length;
  const oldLast = sheet.getLastRow();
  if (rows.length > 0) {
    const needed = rows.length + 1;
    if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    const range = sheet.getRange(2, 1, rows.length, width);
    range.setNumberFormat('@');
    range.setValues(
      rows.map(function (row) {
        return row.map(function (v) {
          return v === null || v === undefined ? '' : String(v);
        });
      })
    );
  }
  if (oldLast > rows.length + 1) sheet.getRange(rows.length + 2, 1, oldLast - rows.length - 1, width).clearContent();
}

function readSettings_() {
  const out = Object.create(null);
  readRows_('Settings').forEach(function (r) {
    out[r[0]] = r[1];
  });
  return out;
}

function currentVersion_() {
  return Number(readSettings_().version) || 0;
}

/** Версия растёт последней в каждой записи: недописанный снимок при чтении сам исправится на следующем опросе. */
function bump_(patch) {
  const settings = readSettings_();
  const version = (Number(settings.version) || 0) + 1;
  settings.version = String(version);
  Object.keys(patch).forEach(function (k) {
    settings[k] = patch[k];
  });
  writeRows_(
    'Settings',
    Object.keys(settings).map(function (k) {
      return [k, settings[k]];
    })
  );
  return version;
}

/** Сотрудники вместе с причиной исключения из рейтинга (она не публична: в GET уходит publicStaff_). */
function readStaff_() {
  return readRows_('Staff').map(function (r) {
    let transfers = [];
    try {
      const parsed = JSON.parse(r[8] || '[]');
      if (Array.isArray(parsed)) transfers = parsed;
    } catch (err) {
      transfers = [];
    }
    return {
      id: r[0],
      name: r[1],
      shortName: r[2],
      group: r[3],
      hireDate: r[4] || null,
      fireDate: r[5] || null,
      baseLevel: r[6],
      hiddenFromRating: r[7].toLowerCase() === 'true',
      transfers: transfers,
      hiddenReason: r[9] || '',
      paymentPlan: planCell_(r[10]),
    };
  });
}

/** Личный план из ячейки: годное число (как норма: 0…50, до сотых) или null — пусто, мусор, испорчено руками. */
function planCell_(text) {
  if (!/^\d+(\.\d+)?$/.test(String(text).trim())) return null;
  const v = Number(text);
  return isNorm_(v) ? v : null;
}

function publicStaff_(e) {
  return { id: e.id, name: e.name, shortName: e.shortName, group: e.group, hireDate: e.hireDate, fireDate: e.fireDate, baseLevel: e.baseLevel, hiddenFromRating: e.hiddenFromRating, transfers: e.transfers, paymentPlan: e.paymentPlan };
}

function writeStaff_(staff) {
  writeRows_(
    'Staff',
    staff.map(function (e) {
      return [e.id, e.name, e.shortName, e.group, e.hireDate || '', e.fireDate || '', e.baseLevel, e.hiddenFromRating ? 'true' : 'false', JSON.stringify(e.transfers), e.hiddenReason, e.paymentPlan === null ? '' : String(e.paymentPlan)];
    })
  );
}

/** Сохранённый config; испорченная руками ячейка (не JSON, не объект) читается как {}. */
function parseConfig_(text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return isPlainObject_(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

/** Правки config по датам: [{from, config}] по возрастанию from; не-JSON, не массив и негодные записи (ячейку могли испортить руками) отбрасываются. */
function parseConfigChanges_(text) {
  let parsed;
  try {
    parsed = JSON.parse(text || '[]');
  } catch (err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(function (e) {
      return isPlainObject_(e) && isDate_(e.from) && isPlainObject_(e.config);
    })
    .sort(function (a, b) {
      return compare_(a.from, b.from);
    });
}

function readAbsences_() {
  return readRows_('Absences').map(function (r) {
    return { employeeId: r[0], kind: r[1], from: r[2], to: r[3] || null };
  });
}

function nextId_(rows) {
  return (
    rows.reduce(function (max, r) {
      return Math.max(max, Number(r[0]) || 0);
    }, 0) + 1
  );
}

/** Покупки по возрастанию номера; `ref` и причина отмены наружу не уходят. */
function readPurchases_() {
  return readRows_('Purchases')
    .map(function (r) {
      return {
        id: Number(r[0]) || 0, at: r[1], date: r[2], group: r[3], shop: r[4], item: Number(r[5]),
        slot: r[6] === '' ? null : Number(r[6]), employeeId: r[7] || null, cancelledAt: r[9] || null,
      };
    })
    .sort(function (a, b) {
      return a.id - b.id;
    });
}

function readGrants_() {
  return readRows_('Grants').map(function (r) {
    return { id: Number(r[0]) || 0, date: r[1], group: r[2], kind: r[3], delta: Number(r[4]) };
  });
}

function parseJson_(text, fallback) {
  try {
    const v = JSON.parse(text || 'null');
    return v === null ? fallback : v;
  } catch (err) {
    return fallback;
  }
}

/** Гринч: сам по себе ли, сколько минут тишины терпит, последние команды админа. */
function readGrinch_(settings) {
  const g = parseJson_(settings.grinch, {});
  return {
    auto: typeof g.auto === 'boolean' ? g.auto : true,
    quietMin: isIntIn_(g.quietMin, QUIET_MIN, QUIET_MAX) ? g.quietMin : 120,
    commands: Array.isArray(g.commands) ? g.commands : [],
  };
}

/** Команды экрану: последние несколько, не старше десяти минут. */
function readScreenCommands_() {
  const raw = parseJson_(PropertiesService.getScriptProperties().getProperty('SCREEN_COMMANDS'), { commands: [] });
  const list = Array.isArray(raw.commands) ? raw.commands : [];
  const oldest = Date.now() - SCREEN_COMMAND_SEC * 1000;
  return list.filter(function (c) {
    return Date.parse(c.at) >= oldest;
  });
}

function readFinale_(settings) {
  const f = parseJson_(settings.finale, null);
  return f && isDate_(f.cutoff) ? { cutoff: f.cutoff, at: String(f.at) } : null;
}

/** Текст админа в ячейке: не пустой, не длинный и не формула. */
function reason_(v) {
  if (typeof v !== 'string') fail_();
  const text = v.trim();
  if (text === '' || text.length > REASON_MAX || /^[=+\-@]/.test(text)) fail_();
  return text;
}

function ref_(v) {
  if (typeof v !== 'string' || v === '' || v.length > REF_MAX) fail_();
  return v;
}

/** Ключ экрана: без него снимок не отдаётся (в нём ФИО). Создаётся при первом верном входе. */
function screenKey_() {
  return PropertiesService.getScriptProperties().getProperty('SCREEN_KEY');
}

function newScreenKey_() {
  const key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  PropertiesService.getScriptProperties().setProperty('SCREEN_KEY', key);
  return key;
}

/** Правки фактов по возрастанию id; `ref` (ключ повтора запроса) остаётся только здесь, в GET не уходит. */
function readCorrections_() {
  return readRows_('Corrections')
    .map(function (r) {
      return { id: Number(r[0]) || 0, date: r[1], employeeId: r[2], kind: r[3], delta: Number(r[4]), base: Number(r[5]), ref: r[6] };
    })
    .sort(function (a, b) {
      return a.id - b.id;
    });
}

// ---------------------------------------------------------------- PIN

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) {
      return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1);
    })
    .join('');
}

function hashPin_(pin, salt) {
  return salt + '$' + sha256Hex_(salt + ':' + pin);
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function matchesHash_(pin, stored) {
  if (typeof stored !== 'string') return false;
  const i = stored.indexOf('$');
  return i > 0 && sameText_(hashPin_(pin, stored.slice(0, i)), stored);
}

/** Сохраняет админ-PIN солёным хешем; сам PIN нигде не хранится. */
function storePin_(pin) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN_HASH', hashPin_(pin, Utilities.getUuid()));
}

function matchesAdminPin_(pin) {
  return matchesHash_(pin, PropertiesService.getScriptProperties().getProperty('ADMIN_PIN_HASH'));
}

function readGroupHashes_() {
  try {
    const parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty('GROUP_PINS') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function groupOfPin_(pin) {
  const hashes = readGroupHashes_();
  let found = null;
  GROUPS.forEach(function (g) {
    if (matchesHash_(pin, hashes[g])) found = g;
  });
  return found;
}

/** Секунд до конца блокировки для связки PIN (`pin` — админ, `group_pin_<группа>` — каждая группа отдельно); 0 — не заблокировано. */
function lockRemainingSec_(prefix) {
  const until = Number(CacheService.getScriptCache().get(prefix + '_lock_until'));
  if (!until) return 0;
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

/** Записывает неверный PIN; на пятом подряд ставит блокировку и возвращает её длину в секундах (иначе 0). */
function recordPinFailure_(prefix) {
  const cache = CacheService.getScriptCache();
  const fails = (Number(cache.get(prefix + '_fails')) || 0) + 1;
  if (fails < MAX_PIN_FAILURES) {
    cache.put(prefix + '_fails', String(fails), PIN_BLOCK_SEC);
    return 0;
  }
  cache.put(prefix + '_lock_until', String(Date.now() + PIN_BLOCK_SEC * 1000), PIN_BLOCK_SEC);
  cache.remove(prefix + '_fails');
  return PIN_BLOCK_SEC;
}

/**
 * { denied } с готовым ответом или { group } (для админа null). PIN группы проверяется только против хеша заявленной
 * `body.group` и считает ошибки отдельно по каждой группе: общий счётчик давал бы перебор 6-значных PIN чужих групп,
 * сбрасываясь верным входом «своей». PIN не строка — просто отказ, в счётчик не идёт.
 */
function authorize_(who, body) {
  if (who === 'group' && !isGroup_(body.group)) return { denied: { ok: false, error: 'bad_request' } };
  const prefix = who === 'admin' ? 'pin' : 'group_pin_' + body.group;
  const waitSec = lockRemainingSec_(prefix);
  if (waitSec > 0) return { denied: { ok: false, error: 'locked', retryAfterSec: waitSec } };
  const given = body[who === 'admin' ? 'pin' : 'groupPin'];
  if (typeof given !== 'string') return { denied: { ok: false, error: 'invalid_pin' } };
  const group = who === 'admin' ? null : body.group;
  const verified = who === 'admin' ? matchesAdminPin_(given) : matchesHash_(given, readGroupHashes_()[group]);
  if (!verified) {
    const blockSec = recordPinFailure_(prefix);
    return { denied: blockSec > 0 ? { ok: false, error: 'locked', retryAfterSec: blockSec } : { ok: false, error: 'invalid_pin' } };
  }
  CacheService.getScriptCache().remove(prefix + '_fails');
  return { group: group };
}

/** Шесть цифр из случайных байтов UUID; байты ≥ 250 отбрасываются, чтобы цифры были равновероятны. */
function randomPin_() {
  let digits = '';
  while (digits.length < 6) {
    const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    for (let i = 0; i + 1 < hex.length && digits.length < 6; i += 2) {
      const byte = parseInt(hex.substr(i, 2), 16);
      if (byte < 250) digits += String(byte % 10);
    }
  }
  return digits;
}

// ---------------------------------------------------------------- действия

function loginAction_() {
  return { ok: true, screenKey: screenKey_() || newScreenKey_() };
}

/** Новый ключ экрана: старые ссылки перестают работать сразу. */
function setScreenKeyAction_() {
  return { ok: true, screenKey: newScreenKey_() };
}

function changePinAction_(body) {
  const pin = body.newPin;
  if (typeof pin !== 'string' || !PIN_FORMAT.test(pin) || groupOfPin_(pin) !== null) fail_();
  storePin_(pin);
  return { ok: true };
}

function setGroupPinsAction_() {
  const groupPins = {};
  const hashes = {};
  const used = [];
  GROUPS.forEach(function (g) {
    let pin;
    do {
      pin = randomPin_();
    } while (used.indexOf(pin) >= 0 || matchesAdminPin_(pin));
    used.push(pin);
    groupPins[g] = pin;
    hashes[g] = hashPin_(pin, Utilities.getUuid());
  });
  PropertiesService.getScriptProperties().setProperty('GROUP_PINS', JSON.stringify(hashes));
  return { ok: true, groupPins: groupPins };
}

function groupLoginAction_(body, auth) {
  return { ok: true, group: auth.group, screenKey: screenKey_() || newScreenKey_() };
}

function provisionalOf_(rows, date, group) {
  const row = rows.filter(function (r) {
    return r[0] === date && r[1] === group;
  })[0];
  return row ? Number(row[2]) || 0 : 0;
}

/**
 * Пишет число предварительных оплат группы за день и разницу — в журнал. Последняя платёжка (по ней просыпается Гринч)
 * двигается, только когда сумма филиала за сегодня превысила прежний максимум дня: «+1 и сразу −1» его не прогоняет.
 */
function writeProvisional_(date, group, count, source, ref) {
  const rows = readRows_('Provisional');
  const before = provisionalOf_(rows, date, group);
  const row = rows.filter(function (r) {
    return r[0] === date && r[1] === group;
  })[0];
  if (row) row[2] = String(count);
  else rows.push([date, group, String(count)]);
  rows.sort(function (a, b) {
    return compare_(a[0], b[0]) || compare_(a[1], b[1]);
  });
  writeRows_('Provisional', rows);
  if (count !== before) {
    const log = readRows_('PaymentLog');
    log.push([String(nextId_(log)), now_(), date, group, String(count - before), source, ref]);
    writeRows_('PaymentLog', log);
  }
  const patch = {};
  if (date === today_()) {
    const total = rows.reduce(function (sum, r) {
      return r[0] === date ? sum + (Number(r[2]) || 0) : sum;
    }, 0);
    const seen = parseJson_(readSettings_().payMax, {});
    const max = seen.date === date ? Number(seen.max) || 0 : 0;
    if (total > max) {
      patch.payMax = JSON.stringify({ date: date, max: total });
      patch.lastPaymentAt = now_();
    }
  }
  return bump_(patch);
}

function setProvisionalAction_(body) {
  const date = body.date;
  const group = body.group;
  if (!isDate_(date) || date > today_() || !isGroup_(group) || !isCount_(body.count)) fail_();
  const through = readSettings_().paymentsImportedThrough;
  if (through && date <= through) fail_();
  return { ok: true, version: writeProvisional_(date, group, body.count, 'admin', '') };
}

/** Платёжка РГ: плюс или минус одна за сегодня. Утренний файл заменит. Повтор `ref` ничего не меняет. */
function addPaymentAction_(body, auth) {
  if (body.delta !== 1 && body.delta !== -1) fail_();
  const ref = ref_(body.ref);
  const group = auth.group;
  const date = today_();
  const settings = readSettings_();
  const current = provisionalOf_(readRows_('Provisional'), date, group);
  const mine = readRows_('PaymentLog').filter(function (r) {
    return r[3] === group && r[5] === 'rg';
  });
  if (mine.some(function (r) { return r[6] === ref; })) return { ok: true, version: currentVersion_(), count: current, duplicate: true };
  if (readFinale_(settings)) return { ok: false, error: 'finished' };
  if (settings.paymentsImportedThrough && date <= settings.paymentsImportedThrough) fail_();
  const count = current + body.delta;
  const clicks = mine.filter(function (r) {
    return r[2] === date;
  }).length;
  if (count < 0 || count > MAX_PAYMENTS_PER_DAY || clicks >= MAX_PAYMENT_CLICKS) fail_();
  return { ok: true, version: writeProvisional_(date, group, count, 'rg', ref), count: count };
}

function importPaymentsAction_(body) {
  const from = body.from;
  const to = body.to;
  if (!isDate_(from) || !isDate_(to) || from > to || to >= today_() || daysInclusive_(from, to) > MAX_IMPORT_DAYS) fail_();
  if (!Array.isArray(body.rows)) fail_();
  // Форма строки проверяется у всех (мусор отклоняет файл), а выгрузка «хвостом» (сегодня, прошлый месяц) не ломает
  // импорт: строки вне периода отбрасываются и считаются в ignored.
  const valid = body.rows.map(function (r) {
    const ok =
      r && typeof r === 'object' && isDate_(r.date) && isGroup_(r.group) &&
      typeof r.author === 'string' && typeof r.invoice === 'string' && r.invoice.trim() !== '';
    if (!ok) fail_();
    return [r.date, r.group, r.author.trim(), r.invoice.trim()];
  });
  const added = valid.filter(function (r) {
    return r[0] >= from && r[0] <= to;
  });
  const inPeriod = function (r) {
    return r[0] >= from && r[0] <= to;
  };
  const old = readRows_('Payments');
  const kept = old.filter(function (r) {
    return !inPeriod(r);
  });
  const provisional = readRows_('Provisional');
  const provisionalKept = provisional.filter(function (r) {
    return !inPeriod(r);
  });
  const removedProvisional = provisional.filter(inPeriod).reduce(function (sum, r) {
    return sum + Number(r[2]);
  }, 0);
  const summary = {
    added: added.length,
    ignored: valid.length - added.length,
    removed: old.length - kept.length,
    removedProvisional: removedProvisional,
  };
  if (body.dryRun === true) return Object.assign({ ok: true, dryRun: true }, summary);

  const payments = kept.concat(added).sort(function (a, b) {
    return compare_(a[0], b[0]) || compare_(a[3], b[3]) || compare_(a[1], b[1]) || compare_(a[2], b[2]);
  });
  writeRows_('Payments', payments);
  if (provisionalKept.length !== provisional.length) writeRows_('Provisional', provisionalKept);
  const previous = readSettings_().paymentsImportedThrough;
  const version = bump_({ paymentsImportedThrough: previous && previous > to ? previous : to });
  return Object.assign({ ok: true, version: version }, summary);
}

function importFunnelAction_(body) {
  const through = body.through;
  if (!isDate_(through) || through >= today_() || !Array.isArray(body.rows)) fail_();
  const staff = readStaff_();
  const byName = Object.create(null);
  staff.forEach(function (e) {
    byName[normalizeName_(e.name)] = e.id;
  });
  const rank = Object.create(null);
  staff.forEach(function (e, i) {
    rank[e.id] = i;
  });
  // Файл воронки содержит колонки до конца месяца (нули без данных): дни после through отбрасываются и считаются в
  // ignored, а мусор (неизвестное ФИО, плохая дата, счётчики) по-прежнему отклоняет весь файл.
  const valid = body.rows.map(function (r) {
    const employeeId = r && typeof r === 'object' && typeof r.name === 'string' ? byName[normalizeName_(r.name)] : undefined;
    if (!employeeId || !isDate_(r.date) || !isCount_(r.quality) || !isCount_(r.long)) fail_();
    return [employeeId, r.date, String(r.quality), String(r.long)];
  });
  const incoming = valid.filter(function (r) {
    return r[1] <= through;
  });
  const merged = Object.create(null);
  readRows_('Funnel').concat(incoming).forEach(function (r) {
    merged[r[0] + '|' + r[1]] = r;
  });
  const rows = Object.keys(merged)
    .map(function (k) {
      return merged[k];
    })
    .sort(function (a, b) {
      const ra = a[0] in rank ? rank[a[0]] : 1e9;
      const rb = b[0] in rank ? rank[b[0]] : 1e9;
      return compare_(a[1], b[1]) || ra - rb || compare_(a[0], b[0]);
    });
  writeRows_('Funnel', rows);
  return { ok: true, version: bump_({ funnelThrough: through }), added: incoming.length, ignored: valid.length - incoming.length };
}

/** «Фамилия И.» из полного ФИО; одно слово остаётся как есть. */
function defaultShortName_(name) {
  const parts = name.split(' ');
  return parts.length > 1 ? parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.' : name;
}

function optionalDate_(v) {
  if (v !== null && !isDate_(v)) fail_();
  return v;
}

function validTransfers_(v) {
  if (!Array.isArray(v)) fail_();
  return v
    .map(function (t) {
      if (!t || typeof t !== 'object' || !isDate_(t.date) || !isGroup_(t.group)) fail_();
      return { date: t.date, group: t.group };
    })
    .sort(function (a, b) {
      return compare_(a.date, b.date);
    });
}

function setStaffAction_(body) {
  if (!Array.isArray(body.staff)) fail_();
  const staff = readStaff_();
  const byKey = Object.create(null);
  let maxId = 0;
  staff.forEach(function (e) {
    byKey[normalizeName_(e.name)] = e;
    const n = /^e(\d+)$/.exec(e.id);
    if (n) maxId = Math.max(maxId, Number(n[1]));
  });
  const seen = Object.create(null);
  let added = 0;
  let updated = 0;
  body.staff.forEach(function (item) {
    if (!item || typeof item !== 'object' || typeof item.name !== 'string') fail_();
    const name = item.name.trim().replace(/\s+/g, ' ');
    const key = normalizeName_(name);
    if (name === '' || seen[key]) fail_();
    seen[key] = true;
    let e = byKey[key];
    if (e) {
      updated++;
    } else {
      if (!isGroup_(item.group)) fail_();
      e = { id: 'e' + ++maxId, name: name, shortName: defaultShortName_(name), group: item.group, hireDate: null, fireDate: null, baseLevel: 'experienced', hiddenFromRating: false, transfers: [], hiddenReason: '', paymentPlan: null };
      byKey[key] = e;
      staff.push(e);
      added++;
    }
    if (item.group !== undefined) {
      if (!isGroup_(item.group)) fail_();
      e.group = item.group;
    }
    if (item.shortName !== undefined) {
      if (typeof item.shortName !== 'string' || item.shortName.trim() === '') fail_();
      e.shortName = item.shortName.trim();
    }
    if (item.hireDate !== undefined) e.hireDate = optionalDate_(item.hireDate);
    if (item.fireDate !== undefined) e.fireDate = optionalDate_(item.fireDate);
    if (item.baseLevel !== undefined) {
      if (LEVELS.indexOf(item.baseLevel) < 0) fail_();
      e.baseLevel = item.baseLevel;
    }
    if (item.hiddenFromRating !== undefined) {
      if (typeof item.hiddenFromRating !== 'boolean') fail_();
      e.hiddenFromRating = item.hiddenFromRating;
    }
    if (item.hiddenReason !== undefined) {
      if (typeof item.hiddenReason !== 'string') fail_();
      e.hiddenReason = item.hiddenReason.trim();
      if (e.hiddenReason.length > HIDDEN_REASON_MAX) fail_();
    }
    // скрытие требует причины (прежняя остаётся, если новую не прислали), снятие флага её стирает
    if (item.hiddenFromRating !== undefined || item.hiddenReason !== undefined) {
      if (!e.hiddenFromRating) e.hiddenReason = '';
      else if (e.hiddenReason === '') fail_();
    }
    if (item.transfers !== undefined) e.transfers = validTransfers_(item.transfers);
    if (item.paymentPlan !== undefined) {
      if (item.paymentPlan !== null && !isNorm_(item.paymentPlan)) fail_();
      e.paymentPlan = item.paymentPlan;
    }
  });
  if (added + updated === 0) return { ok: true, version: currentVersion_(), added: 0, updated: 0 };
  writeStaff_(staff);
  return { ok: true, version: bump_({}), added: added, updated: updated };
}

/** Причины и журнал внесений: в снимок они не попадают, админ читает их отдельно. */
function getPrivateAction_() {
  const hiddenReasons = {};
  readStaff_().forEach(function (e) {
    if (e.hiddenFromRating && e.hiddenReason !== '') hiddenReasons[e.id] = e.hiddenReason;
  });
  const cancelReasons = {};
  readRows_('Purchases').forEach(function (r) {
    if (r[9] !== '') cancelReasons[r[0]] = r[10];
  });
  const grantReasons = {};
  readRows_('Grants').forEach(function (r) {
    grantReasons[r[0]] = r[5];
  });
  const paymentLog = readRows_('PaymentLog').map(function (r) {
    return { id: Number(r[0]) || 0, at: r[1], date: r[2], group: r[3], delta: Number(r[4]), source: r[5] };
  });
  return { ok: true, hiddenReasons: hiddenReasons, cancelReasons: cancelReasons, grantReasons: grantReasons, paymentLog: paymentLog };
}

/** Сливает частичные нормы по уровням в сохранённые; пустой уровень или поле вне quality|long|payments — bad_request. */
function mergeNorms_(base, patch) {
  if (!isPlainObject_(patch) || Object.keys(patch).length === 0) fail_();
  const out = isPlainObject_(base) ? base : {};
  Object.keys(patch).forEach(function (level) {
    const fields = isPlainObject_(patch[level]) ? Object.keys(patch[level]) : [];
    if (LEVELS.indexOf(level) < 0 || fields.length === 0) fail_();
    const norm = isPlainObject_(out[level]) ? out[level] : {};
    fields.forEach(function (f) {
      const v = patch[level][f];
      if (NORM_FIELDS.indexOf(f) < 0 || !isNorm_(v)) fail_();
      norm[f] = patch[level][f];
    });
    out[level] = norm;
  });
  return out;
}

/** Проверяет и вносит патч в `target`; пороги стадий — только когда они разрешены (на всю игру, не с даты). Негодное — bad_request. */
function applyConfigPatch_(target, patch) {
  Object.keys(patch).forEach(function (k) {
    const v = patch[k];
    if (k !== 'norms') fail_();
    target.norms = mergeNorms_(target.norms, v);
  });
}

/** Правка на всю игру отменяет записи по датам для тех же полей (нормы — по уровню и полю); опустевшие записи удаляются. */
function stripConfigFields_(changes, patch) {
  changes.forEach(function (e) {
    Object.keys(patch).forEach(function (k) {
      if (k === 'norms') {
        Object.keys(patch.norms).forEach(function (level) {
          if (!isPlainObject_(e.config.norms) || !isPlainObject_(e.config.norms[level])) return;
          Object.keys(patch.norms[level]).forEach(function (f) {
            delete e.config.norms[level][f];
          });
          if (Object.keys(e.config.norms[level]).length === 0) delete e.config.norms[level];
        });
        if (isPlainObject_(e.config.norms) && Object.keys(e.config.norms).length === 0) delete e.config.norms;
      }
    });
  });
  return changes.filter(function (e) {
    return Object.keys(e.config).length > 0;
  });
}

/** setConfig: без `from` (нет или null) — на всю игру; с `from` — правка, действующая с этой даты. */
function setConfigAction_(body) {
  const patch = body.config;
  if (!isPlainObject_(patch) || Object.keys(patch).length === 0) fail_();
  const settings = readSettings_();
  const config = parseConfig_(settings.config);
  let changes = parseConfigChanges_(settings.configChanges);
  if (body.from === undefined || body.from === null) {
    applyConfigPatch_(config, patch);
    changes = stripConfigFields_(changes, patch);
  } else {
    if (!isDate_(body.from)) fail_();
    let entry = null;
    changes.forEach(function (e) {
      if (entry === null && e.from === body.from) entry = e;
    });
    if (entry === null) {
      if (changes.length >= CONFIG_CHANGES_MAX) fail_();
      entry = { from: body.from, config: {} };
      changes.push(entry);
      changes.sort(function (a, b) {
        return compare_(a.from, b.from);
      });
    }
    applyConfigPatch_(entry.config, patch);
  }
  return {
    ok: true,
    version: bump_({ config: JSON.stringify(config), configChanges: JSON.stringify(changes) }),
    config: config,
    configChanges: changes,
  };
}

function removeConfigChangeAction_(body) {
  if (!isDate_(body.from)) fail_();
  const changes = parseConfigChanges_(readSettings_().configChanges);
  const kept = changes.filter(function (e) {
    return e.from !== body.from;
  });
  if (kept.length === changes.length) fail_();
  return { ok: true, version: bump_({ configChanges: JSON.stringify(kept) }), configChanges: kept };
}

/** Покупка РГ. Монеты сервер не знает (их считает движок); группа — из проверенного PIN, дата — сегодня на сервере. */
function buyAction_(body, auth) {
  const range = typeof body.shop === 'string' && Object.prototype.hasOwnProperty.call(SHOPS, body.shop) ? SHOPS[body.shop] : null;
  if (!range || !isIntIn_(body.item, range[0], range[1])) fail_();
  const slot = body.slot === undefined ? null : body.slot;
  if (body.shop === 'tree' ? !isIntIn_(slot, 1, TREE_SLOTS) : slot !== null) fail_();
  const employeeId = body.employeeId === undefined ? null : body.employeeId;
  const ref = ref_(body.ref);
  const group = auth.group;
  const rows = readRows_('Purchases');
  const same = rows.filter(function (r) {
    return r[3] === group && r[8] === ref;
  })[0];
  if (same) return { ok: true, version: currentVersion_(), id: Number(same[0]), duplicate: true };
  if (readFinale_(readSettings_())) return { ok: false, error: 'finished' };
  if (employeeId !== null) {
    const known = typeof employeeId === 'string' && readStaff_().some(function (e) {
      return e.id === employeeId;
    });
    if (!known) fail_();
  }
  const date = today_();
  const bought = rows.filter(function (r) {
    return r[2] === date && r[3] === group;
  }).length;
  if (bought >= MAX_BUYS_PER_DAY) fail_();
  const id = nextId_(rows);
  rows.push([String(id), now_(), date, group, body.shop, String(body.item), slot === null ? '' : String(slot), employeeId || '', ref, '', '']);
  writeRows_('Purchases', rows);
  return { ok: true, version: bump_({}), id: id };
}

/** Отмена покупки админом: запись остаётся с причиной, вещь и валюта возвращаются при пересчёте. */
function cancelPurchaseAction_(body) {
  if (!isIntIn_(body.id, 1, Number.MAX_SAFE_INTEGER)) fail_();
  const reason = reason_(body.reason);
  const rows = readRows_('Purchases');
  const row = rows.filter(function (r) {
    return Number(r[0]) === body.id;
  })[0];
  if (!row || row[9] !== '') fail_();
  row[9] = now_();
  row[10] = reason;
  writeRows_('Purchases', rows);
  return { ok: true, version: bump_({}) };
}

/** Выдача (или изъятие) валюты группе: на процент плана и звезду не влияет. */
function grantAction_(body) {
  if (!isGroup_(body.group) || CURRENCIES.indexOf(body.kind) < 0) fail_();
  if (!isIntIn_(body.delta, -GRANT_MAX, GRANT_MAX) || body.delta === 0) fail_();
  const reason = reason_(body.reason);
  const ref = ref_(body.ref);
  const rows = readRows_('Grants');
  const same = rows.filter(function (r) {
    return r[6] === ref;
  })[0];
  if (same) return { ok: true, version: currentVersion_(), id: Number(same[0]), duplicate: true };
  const id = nextId_(rows);
  rows.push([String(id), today_(), body.group, body.kind, String(body.delta), reason, ref]);
  writeRows_('Grants', rows);
  return { ok: true, version: bump_({}), id: id };
}

function setGrinchAction_(body) {
  if (typeof body.auto !== 'boolean' || !isIntIn_(body.quietMin, QUIET_MIN, QUIET_MAX)) fail_();
  const g = readGrinch_(readSettings_());
  g.auto = body.auto;
  g.quietMin = body.quietMin;
  return { ok: true, version: bump_({ grinch: JSON.stringify(g) }) };
}

function grinchCommandAction_(body) {
  if (GRINCH_KINDS.indexOf(body.kind) < 0) fail_();
  const g = readGrinch_(readSettings_());
  const last = g.commands[g.commands.length - 1];
  g.commands = g.commands.concat([{ id: (last ? last.id : 0) + 1, kind: body.kind, at: now_() }]).slice(-GRINCH_COMMANDS_KEPT);
  return { ok: true, version: bump_({ grinch: JSON.stringify(g) }) };
}

/** Команда экрану (сцена по кнопке): очередь в свойствах скрипта, версия растёт, чтобы экран узнал сразу. */
function screenCommandAction_(body) {
  if (SCREEN_KINDS.indexOf(body.kind) < 0) fail_();
  const group = body.group === undefined ? null : body.group;
  if (group !== null && !isGroup_(group)) fail_();
  if (body.kind === 'snowball' && group === null) fail_();
  const props = PropertiesService.getScriptProperties();
  const raw = parseJson_(props.getProperty('SCREEN_COMMANDS'), { lastId: 0, commands: [] });
  const id = (Number(raw.lastId) || 0) + 1;
  const commands = (Array.isArray(raw.commands) ? raw.commands : [])
    .concat([{ id: id, at: now_(), kind: body.kind, group: group }])
    .slice(-SCREEN_COMMANDS_KEPT);
  props.setProperty('SCREEN_COMMANDS', JSON.stringify({ lastId: id, commands: commands }));
  return { ok: true, version: bump_({}), id: id };
}

/** Финал: последний день, который считается, — не позже официального импорта. */
function setFinaleAction_(body) {
  const through = readSettings_().paymentsImportedThrough;
  if (!isDate_(body.cutoff) || body.cutoff < GAME_START || body.cutoff > GAME_END || !through || body.cutoff > through) fail_();
  return { ok: true, version: bump_({ finale: JSON.stringify({ cutoff: body.cutoff, at: now_() }) }) };
}

function clearFinaleAction_() {
  if (!readFinale_(readSettings_())) fail_();
  return { ok: true, version: bump_({ finale: '' }) };
}

function setAbsenceAction_(body) {
  const employeeId = body.employeeId;
  const known = typeof employeeId === 'string' && readStaff_().some(function (e) {
    return e.id === employeeId;
  });
  if (!known || ABSENCE_KINDS.indexOf(body.kind) < 0 || !isDate_(body.from)) fail_();
  const to = body.to === undefined ? null : body.to;
  if (to !== null && (!isDate_(to) || to < body.from)) fail_();
  const rows = readRows_('Absences');
  const row = rows.filter(function (r) {
    return r[0] === employeeId && r[2] === body.from;
  })[0];
  if (row) {
    row[1] = body.kind;
    row[3] = to || '';
  } else {
    rows.push([employeeId, body.kind, body.from, to || '']);
  }
  writeRows_('Absences', rows);
  return { ok: true, version: bump_({}) };
}

function removeAbsenceAction_(body) {
  if (typeof body.employeeId !== 'string' || !isDate_(body.from)) fail_();
  const rows = readRows_('Absences');
  const kept = rows.filter(function (r) {
    return !(r[0] === body.employeeId && r[2] === body.from);
  });
  const removed = rows.length - kept.length;
  if (removed === 0) return { ok: true, version: currentVersion_(), removed: 0 };
  writeRows_('Absences', kept);
  return { ok: true, version: bump_({}), removed: removed };
}

/** Выходные дни игры: список заменяется целиком, хранится отсортированным в Settings.config.nonWorking (остальной config не трогается). */
function setNonWorkingAction_(body) {
  const list = body.nonWorking;
  if (!Array.isArray(list) || list.length > NON_WORKING_MAX) fail_();
  const seen = Object.create(null);
  list.forEach(function (d) {
    if (!isDate_(d) || d < GAME_START || d > GAME_END || seen[d]) fail_();
    seen[d] = true;
  });
  const nonWorking = list.slice().sort(compare_);
  const config = parseConfig_(readSettings_().config);
  config.nonWorking = nonWorking;
  return { ok: true, version: bump_({ config: JSON.stringify(config) }), nonWorking: nonWorking };
}

/**
 * Ручные правки фактов (1–3 записи за запрос): сначала проверяются все, потом пишутся вместе. Дата — день игры строго до
 * сегодняшнего. `ref` — случайная строка клиента: повтор запроса с тем же `ref` ничего не пишет и отвечает прежними id.
 */
function addCorrectionsAction_(body) {
  const items = body.items;
  const ref = body.ref;
  if (typeof ref !== 'string' || ref === '' || ref.length > REF_MAX) fail_();
  if (!Array.isArray(items) || items.length < 1 || items.length > CORRECTION_ITEMS_MAX) fail_();
  const known = Object.create(null);
  readStaff_().forEach(function (e) {
    known[e.id] = true;
  });
  const today = today_();
  items.forEach(function (item) {
    const ok =
      isPlainObject_(item) && isDate_(item.date) && item.date >= GAME_START && item.date <= GAME_END && item.date < today &&
      typeof item.employeeId === 'string' && known[item.employeeId] === true &&
      CORRECTION_KINDS.indexOf(item.kind) >= 0 &&
      isIntIn_(item.delta, -CORRECTION_DELTA_MAX, CORRECTION_DELTA_MAX) && item.delta !== 0 &&
      isCount_(item.base);
    if (!ok) fail_();
  });
  const rows = readRows_('Corrections');
  const same = rows.filter(function (r) {
    return r[6] === ref;
  });
  if (same.length > 0) {
    return {
      ok: true,
      version: currentVersion_(),
      ids: same.map(function (r) {
        return Number(r[0]);
      }),
      duplicate: true,
    };
  }
  if (rows.length + items.length > CORRECTIONS_MAX) fail_();
  // Правки удаляются, поэтому номер не берётся из листа одним максимумом: последний выданный хранится в Settings
  // (correctionsLastId) и номера не повторяются, иначе запоздалый removeCorrection снёс бы новую правку.
  let id = rows.reduce(function (max, r) {
    return Math.max(max, Number(r[0]) || 0);
  }, Number(readSettings_().correctionsLastId) || 0);
  const ids = [];
  items.forEach(function (item) {
    id++;
    ids.push(id);
    rows.push([String(id), item.date, item.employeeId, item.kind, String(item.delta), String(item.base), ref]);
  });
  writeRows_('Corrections', rows);
  return { ok: true, version: bump_({ correctionsLastId: String(id) }), ids: ids };
}

function removeCorrectionAction_(body) {
  if (!isIntIn_(body.id, 1, Number.MAX_SAFE_INTEGER)) fail_();
  const rows = readRows_('Corrections');
  const kept = rows.filter(function (r) {
    return Number(r[0]) !== body.id;
  });
  const removed = rows.length - kept.length;
  if (removed === 0) return { ok: true, version: currentVersion_(), removed: 0 };
  writeRows_('Corrections', kept);
  return { ok: true, version: bump_({}), removed: removed };
}

/** who: чей PIN нужен — 'admin' (поле pin) или 'group' (поле groupPin). Админ-действия PIN группы не открывает. */
const ACTIONS_ = {
  login: { who: 'admin', run: loginAction_ },
  changePin: { who: 'admin', run: changePinAction_ },
  setGroupPins: { who: 'admin', run: setGroupPinsAction_ },
  groupLogin: { who: 'group', run: groupLoginAction_ },
  setProvisional: { who: 'admin', run: setProvisionalAction_ },
  importPayments: { who: 'admin', run: importPaymentsAction_ },
  importFunnel: { who: 'admin', run: importFunnelAction_ },
  setStaff: { who: 'admin', run: setStaffAction_ },
  getPrivate: { who: 'admin', run: getPrivateAction_ },
  setConfig: { who: 'admin', run: setConfigAction_ },
  removeConfigChange: { who: 'admin', run: removeConfigChangeAction_ },
  addPayment: { who: 'group', run: addPaymentAction_ },
  buy: { who: 'group', run: buyAction_ },
  cancelPurchase: { who: 'admin', run: cancelPurchaseAction_ },
  grant: { who: 'admin', run: grantAction_ },
  setGrinch: { who: 'admin', run: setGrinchAction_ },
  grinchCommand: { who: 'admin', run: grinchCommandAction_ },
  screenCommand: { who: 'admin', run: screenCommandAction_ },
  setFinale: { who: 'admin', run: setFinaleAction_ },
  clearFinale: { who: 'admin', run: clearFinaleAction_ },
  setScreenKey: { who: 'admin', run: setScreenKeyAction_ },
  setAbsence: { who: 'admin', run: setAbsenceAction_ },
  removeAbsence: { who: 'admin', run: removeAbsenceAction_ },
  setNonWorking: { who: 'admin', run: setNonWorkingAction_ },
  addCorrections: { who: 'admin', run: addCorrectionsAction_ },
  removeCorrection: { who: 'admin', run: removeCorrectionAction_ },
};

// ---------------------------------------------------------------- точки входа

function handlePost_(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData ? e.postData.contents : undefined);
  } catch (err) {
    return { ok: false, error: 'bad_request' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_request' };
  const action = body.action;
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS_, action)) return { ok: false, error: 'bad_request' };
  const def = ACTIONS_[action];
  return withLock_(function () {
    const auth = authorize_(def.who, body);
    if (auth.denied) return auth.denied;
    try {
      return def.run(body, auth);
    } catch (err) {
      if (err && err.badRequest) return { ok: false, error: 'bad_request' };
      throw err;
    }
  });
}

function doPost(e) {
  spreadsheetMemo_ = null;
  try {
    return jsonResponse_(handlePost_(e));
  } catch (err) {
    console.error(String((err && err.stack) || err));
    return jsonResponse_({ ok: false, error: 'server_error' });
  }
}

/**
 * Снимок по ключу экрана (`?k=`): ФИО и группы, оплаты, воронка, отсутствия, покупки, выдачи, правки фактов, Гринч, финал.
 * Сумм, хешей, PIN, ключа, причин и журнала внесений в нём нет. `?since=<версия>` при той же версии отдаёт
 * {unchanged, version, serverNow}: «сейчас» нужно клиенту для часов площади.
 */
function doGet(e) {
  spreadsheetMemo_ = null;
  try {
    const params = e && e.parameter ? e.parameter : {};
    const key = screenKey_();
    if (!key || typeof params.k !== 'string' || !sameText_(params.k, key)) return jsonResponse_({ ok: false, error: 'key' });
    const settings = readSettings_();
    const version = Number(settings.version) || 0;
    const since = params.since;
    const serverNow = now_();
    if (typeof since === 'string' && /^\d+$/.test(since) && Number(since) === version) return jsonResponse_({ ok: true, unchanged: true, version: version, serverNow: serverNow });
    return jsonResponse_({
      ok: true,
      version: version,
      serverNow: serverNow,
      funnelThrough: settings.funnelThrough || null,
      paymentsImportedThrough: settings.paymentsImportedThrough || null,
      config: parseConfig_(settings.config),
      configChanges: parseConfigChanges_(settings.configChanges),
      staff: readStaff_().map(publicStaff_),
      absences: readAbsences_(),
      payments: readRows_('Payments').map(function (r) {
        return { date: r[0], group: r[1], author: r[2], invoice: r[3] };
      }),
      provisional: readRows_('Provisional').map(function (r) {
        return { date: r[0], group: r[1], count: Number(r[2]) };
      }),
      funnel: readRows_('Funnel').map(function (r) {
        return { employeeId: r[0], date: r[1], quality: Number(r[2]), long: Number(r[3]) };
      }),
      purchases: readPurchases_(),
      grants: readGrants_(),
      lastPaymentAt: settings.lastPaymentAt || null,
      grinch: readGrinch_(settings),
      finale: readFinale_(settings),
      commands: readScreenCommands_(),
      corrections: readCorrections_().map(function (c) {
        return { id: c.id, date: c.date, employeeId: c.employeeId, kind: c.kind, delta: c.delta, base: c.base };
      }),
    });
  } catch (err) {
    console.error(String((err && err.stack) || err));
    return jsonResponse_({ ok: false, error: 'server_error' });
  }
}

// ---------------------------------------------------------------- запуск вручную из редактора Apps Script

/** Создаёт все листы с заголовками (один раз после указания SPREADSHEET_ID). */
function setupSpreadsheet() {
  Object.keys(SHEETS).forEach(sheetFor_);
}

/** Задаёт первый админ-PIN из свойства INITIAL_PIN и стирает его; повторно PIN меняется через changePin. */
function initAdminPin() {
  const props = PropertiesService.getScriptProperties();
  const pin = props.getProperty('INITIAL_PIN');
  props.deleteProperty('INITIAL_PIN');
  if (props.getProperty('ADMIN_PIN_HASH')) throw new Error('Админ-PIN уже задан; его меняет действие changePin.');
  if (!pin || !PIN_FORMAT.test(pin)) throw new Error('Положите в свойство INITIAL_PIN от 4 до 12 цифр и запустите функцию снова.');
  storePin_(pin);
}

/** Поднимает версию снимка после правки листов руками, чтобы открытые страницы перечитали данные. */
function bumpVersion() {
  return withLock_(function () {
    return bump_({});
  });
}
