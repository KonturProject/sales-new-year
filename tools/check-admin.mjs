// Проверка админки в браузере: поднимает vite и мок-бэкенд (демо «middle», 10.12), открывает системный Chrome/Edge.
// Каждый сценарий получает свой мок и свой контекст браузера: сценарии меняют общее состояние.
// PIN в вывод не попадает. Запуск: npm run check:admin (OUT=папка — снимки экрана вкладок).
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { MOCK_ADMIN_PIN, MOCK_SCREEN_KEY, startMockBackend } from './mock-backend.mjs';

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('Не найден Chrome/Edge: задайте CHROME_PATH');

const OUT = process.env.OUT;
if (OUT) mkdirSync(OUT, { recursive: true });
/** Слова «Питомцев», которых в админке площади быть не должно. */
const PET_WORDS = /питом|кучк|аптечк|вылупл|яйц|скуча|погиб/i;
const TABS = ['results', 'payments', 'import', 'staff', 'norms', 'purchases', 'grinch', 'screen', 'finale', 'pins'];
const failures = [];

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const { port } = server.httpServer.address();
const base = `http://localhost:${port}/`;
const browser = await chromium.launch({ executablePath: browserPath });
const fx = await server.ssrLoadModule('/src/import/fixtures.ts');

/** Свежий мок и контекст; ошибки консоли, страницы и сети становятся провалами сценария. */
async function scenario(name, fn, viewport = { width: 1280, height: 800 }) {
  const mock = await startMockBackend({ port: 0, demo: 'middle' });
  const context = await browser.newContext({ viewport });
  const logs = [];
  const fail = (message) => failures.push(`${name}: ${message}`);
  const check = (ok, message) => { if (!ok) fail(message); };
  const page = await context.newPage();
  page.on('console', (m) => {
    logs.push(m.text());
    if (m.type() === 'error') fail(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => fail(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) fail(`HTTP ${r.status()}: ${r.url()}`); });
  const url = `${base}admin.html?backend=${encodeURIComponent(mock.url)}`;
  try {
    await fn({ page, mock, check, fail, url });
    check(!logs.some((l) => l.includes(MOCK_ADMIN_PIN)), 'PIN попал в консоль');
  } catch (e) {
    fail(`сценарий прервался: ${e.message.split('\n')[0]}`);
  } finally {
    await context.close();
    await mock.close();
  }
  console.log(`${failures.some((f) => f.startsWith(`${name}:`)) ? '✗' : '✓'} ${name}`);
}

async function login(page, url, pin = MOCK_ADMIN_PIN) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.fill('form[data-login] input[type="password"]', pin);
  await page.click('form[data-login] button[type="submit"]');
}

/** Открывает вкладку и ждёт, пока панель перестанет показывать «Загрузка…». */
async function openTab(page, id) {
  await page.click(`[role="tab"][data-tab="${id}"]`);
  await page.waitForFunction((t) => {
    const p = document.querySelector('[role="tabpanel"]');
    return p?.dataset.tab === t && !p.textContent?.startsWith('Загрузка');
  }, id, { timeout: 20_000 });
}

const textOf = (page, selector) => page.$eval(selector, (e) => e.textContent ?? '').catch(() => '');
async function waitForText(page, selector, needle, timeout = 15_000) {
  await page.waitForFunction(([sel, text]) => [...document.querySelectorAll(sel)].some((e) => e.textContent?.includes(text)), [selector, needle], { timeout }).catch(() => {});
  return (await page.$$eval(selector, (es) => es.map((e) => e.textContent ?? '').join(' | ')).catch(() => ''));
}
/** Снимок мока с ключом экрана (по умолчанию — ключ мока). */
const snapshotOf = async (mock, key = MOCK_SCREEN_KEY) => (await fetch(`${mock.url}?k=${encodeURIComponent(key)}`)).json();
/** Ответ «Да» в окне вопроса: раньше 500 мс щелчок не засчитывается. */
async function answerYes(page) {
  const dialog = await page.waitForSelector('dialog.ask[open]', { timeout: 10_000 });
  await page.waitForTimeout(600);
  await (await dialog.$('[data-ask="yes"]')).click();
  // следующий вопрос может открыться сразу: ждём ухода именно этого окна
  await page.waitForFunction((el) => !el.isConnected, dialog, { timeout: 10_000 });
}
const upload = (page, id, name, mimeType, buffer) => page.setInputFiles(`input[data-file="${id}"]`, { name, mimeType, buffer: Buffer.from(buffer) });

try {
  await scenario('вход: поле PIN без name, чужой PIN — ошибка, свой — вкладки', async ({ page, check, url }) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    const input = page.locator('form[data-login] input[type="password"]');
    check(await input.count() === 1, 'нет поля PIN');
    check(await input.getAttribute('name') === null, 'у поля PIN есть name');
    await login(page, url, '0000');
    const alert = await waitForText(page, 'form[data-login] [role="alert"]', ' ');
    check(alert.trim() !== '', 'чужой PIN без сообщения');
    await login(page, url);
    await page.waitForSelector('[role="tablist"]', { timeout: 20_000 });
    check(await page.locator('[role="tab"]').count() === TABS.length, 'не все вкладки на месте');
  });

  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await scenario(`вкладки ${viewport.width}px: открываются без ошибок, без слов «Питомцев», без прокрутки вбок`, async ({ page, check, url }) => {
      await login(page, url);
      await page.waitForSelector('[role="tablist"]', { timeout: 20_000 });
      const today = await textOf(page, 'section.today');
      check(today.includes('Сегодня 10.12'), `блок «Сегодня»: ${today.slice(0, 80)}`);
      check(today.includes('ёлка'), 'в «Сегодня» нет прогноза ёлки');
      for (const id of TABS) {
        await openTab(page, id);
        const text = await textOf(page, 'main, body');
        const pet = text.match(PET_WORDS);
        check(!pet, `вкладка ${id}: слово «${pet?.[0]}»`);
        const alert = await page.$$eval('[role="tabpanel"] [role="alert"]', (es) => es.filter((e) => e.checkVisibility()).map((e) => e.textContent?.trim() ?? '').filter(Boolean).join(' | '));
        check(alert === '', `вкладка ${id}: ${alert}`);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        check(!wide, `вкладка ${id}: прокрутка вбок`);
        if (OUT) await page.screenshot({ path: `${OUT}/admin-${viewport.width}-${id}.png`, fullPage: true });
      }
    }, viewport);
  }

  await scenario('оплаты: число СР1 сохраняется, в журнале — координатор', async ({ page, check, url }) => {
    await login(page, url);
    await openTab(page, 'payments');
    const input = page.locator('input[data-pay="СР1"]');
    const before = Number(await input.inputValue());
    await input.fill(String(before + 2));
    await page.click('form.pay-form button[type="submit"]');
    const status = await waitForText(page, 'form.pay-form [role="status"]', 'Сохранено');
    check(status.includes('Сохранено') && status.includes('СР1'), `статус: ${status}`);
    await page.click('details.pay-journal summary');
    const log = await waitForText(page, '[data-pay-log] li', 'СР1');
    check(/СР1 · \+2 · координатор/.test(log), `журнал: ${log}`);
  });

  await scenario('импорт оплат: бонус Академии 30 ₽ не засчитан, остальное загружено', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'import');
    const d = fx.serialOf('2026-12-09');
    const grid = fx.paymentsGrid([
      fx.paymentLine('NY-1', d, 'АП_НП_СР_Тверь_СР1_ГБ_УД', 'Тест Альфов', 4900),
      fx.paymentLine('NY-2', d, 'АП_НП_СР_Тверь_СР2_ГБ_УД', 'Тест Бетов', 30, 'Академия'),
      fx.paymentLine('NY-3', d, 'АП_НП_СР_Тверь_СР2_ГБ_УД', 'Тест Бетов', 31, 'Академия'),
    ]);
    await upload(page, 'payments', 'оплаты.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fx.toXlsx({ Лист1: grid }));
    const report = await waitForText(page, '[data-report="payments"]', 'Не засчитано');
    check(report.includes('Не засчитано в файле: 1 (бонус Академии 30 ₽ — 1)'), `разбор: ${report.slice(0, 200)}`);
    check(report.includes('Оплат к загрузке: 2'), `к загрузке: ${report.slice(0, 200)}`);
    await page.click('[data-confirm="payments"]');
    const done = await waitForText(page, '[data-report="payments"]', 'Загружено оплат');
    check(done.includes('Загружено оплат: 2'), `итог: ${done.slice(0, 200)}`);
    const snap = await (await fetch(`${mock.url}?k=${MOCK_SCREEN_KEY}`)).json();
    const invoices = (snap.payments ?? []).map((p) => p.invoice);
    check(invoices.includes('NY-1') && invoices.includes('NY-3') && !invoices.includes('NY-2'), `в снимке: ${invoices.filter((i) => i.startsWith('NY')).join(',')}`);
  });

  await scenario('штат из JSON: отсутствие записывается новому сотруднику', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'staff');
    const json = JSON.stringify([{ name: 'Тест Новогодний', group: 'СР2', baseLevel: 'rookie1', hireDate: '2026-12-01', absences: [{ kind: 'vacation', from: '2026-12-14', to: '2026-12-18' }] }]);
    await upload(page, 'staff', 'штат.json', 'application/json', new TextEncoder().encode(json));
    const report = await waitForText(page, '[data-report="staff"]', 'отсутствий');
    check(report.includes('новых: 1') && report.includes('отсутствий: 1'), `разбор: ${report}`);
    await page.click('[data-confirm="staff"]');
    const done = await waitForText(page, '[data-report="staff"]', 'отсутствий записано');
    check(done.includes('Добавлено: 1') && done.includes('отсутствий записано: 1'), `итог: ${done}`);
    const snap = await (await fetch(`${mock.url}?k=${MOCK_SCREEN_KEY}`)).json();
    const id = snap.staff?.find((e) => e.name === 'Тест Новогодний')?.id;
    check(Boolean(id) && snap.absences?.some((a) => a.employeeId === id && a.kind === 'vacation' && a.from === '2026-12-14' && a.to === '2026-12-18'), 'в снимке нет отсутствия');
  });

  await scenario('покупки: отмена только с причиной, причина не уходит в публичный снимок; выдача −5 показывает «станет»', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'purchases');
    const first = page.locator('[data-cancel-open]').first();
    check(await first.count() === 1, 'нет покупок с кнопкой отмены');
    const id = Number(await first.getAttribute('data-cancel-open'));
    await first.click();
    await page.click(`form[data-cancel="${id}"] button[type="submit"]`);
    check((await waitForText(page, '[data-alert="cancel"]', 'причину')).includes('Напишите причину'), 'отмена без причины прошла');
    check(!(await page.$('dialog.ask[open]')), 'без причины открылся вопрос');
    const reason = 'Проверка отмены Q7Z';
    await page.fill(`input[data-cancel-reason="${id}"]`, reason);
    await page.click(`form[data-cancel="${id}"] button[type="submit"]`);
    await page.waitForSelector('dialog.ask[open]');
    await page.click('dialog.ask [data-ask="yes"]'); // сразу — не засчитывается
    check(Boolean(await page.$('dialog.ask[open]')), 'ранний щелчок «Да» засчитался');
    await page.waitForTimeout(600);
    await page.click('dialog.ask [data-ask="yes"]');
    const st = await waitForText(page, '[data-status="cancel"]', 'отменена');
    check(st.includes(`Покупка №${id} отменена`), `отмена: ${st}`);
    check((await textOf(page, `li[data-purchase="${id}"] .note`)).includes(reason), 'в журнале нет причины');
    const pub = await snapshotOf(mock);
    check(pub.purchases.find((x) => x.id === id)?.cancelledAt, 'в снимке покупка не отменена');
    check(!JSON.stringify(pub).includes(reason), 'причина отмены попала в публичный снимок');

    await page.selectOption('[data-grant="group"]', 'СР2');
    await page.selectOption('[data-grant="kind"]', 'flakes');
    await page.fill('[data-grant="delta"]', '-5');
    await page.fill('[data-grant="reason"]', 'Проверка выдачи W3');
    const preview = await textOf(page, '[data-grant-preview]');
    check(/^Станет: СР2: снежинки \S+ → \S+/.test(preview), `станет: ${preview}`);
    await page.click('form[data-grant-form] button[type="submit"]');
    await answerYes(page);
    check((await waitForText(page, '[data-status="grant"]', 'Готово')).includes('Готово'), 'выдача не записалась');
    const after = await snapshotOf(mock);
    check(after.grants.some((g) => g.group === 'СР2' && g.kind === 'flakes' && g.delta === -5), 'в снимке нет выдачи');
    check(!JSON.stringify(after).includes('Проверка выдачи W3'), 'причина выдачи попала в публичный снимок');
  });

  await scenario('Гринч: тишина 29 и 481 — отказ, 30 и 480 — сохраняются; кнопка «Украсть»', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'grinch');
    const save = async (v) => {
      await page.fill('[data-grinch-quiet]', String(v));
      await page.click('form[data-grinch-settings] button[type="submit"]');
    };
    for (const bad of [29, 481]) {
      await save(bad);
      check((await waitForText(page, '[data-alert="grinch"]', 'Тишина')).includes('от 30 до 480'), `тишина ${bad} принята`);
    }
    for (const ok of [30, 480]) {
      await save(ok);
      await waitForText(page, '[data-status="grinch"]', 'сохранены');
      check((await snapshotOf(mock)).grinch.quietMin === ok, `тишина ${ok} не сохранилась`);
    }
    await page.click('[data-grinch="steal"]');
    await waitForText(page, '[data-status="grinch"]', 'отправлено');
    check((await snapshotOf(mock)).grinch.commands.at(-1)?.kind === 'steal', 'команда «Украсть» не дошла');
    await page.selectOption('[data-snowball-group]', 'СР6');
    await page.click('[data-snowball]');
    await waitForText(page, '[data-status="grinch"]', 'Снежок');
    check((await snapshotOf(mock)).commands.some((c) => c.kind === 'snowball' && c.group === 'СР6'), 'снежок не дошёл');
  });

  await scenario('экран: салют, ссылка с ключом, новый ключ — старый не читает, админка работает', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'screen');
    await page.click('[data-screen="salute"]');
    await waitForText(page, '[data-status="screen"]', 'Салют');
    check((await snapshotOf(mock)).commands.some((c) => c.kind === 'salute'), 'салют не дошёл');
    await page.click('[data-show-link]');
    const link = await page.inputValue('[data-screen-link] input');
    check(link.endsWith(`#k=${MOCK_SCREEN_KEY}`) && !link.includes('admin.html'), 'ссылка экрана не та');
    await page.click('[data-new-key]');
    await answerYes(page);
    await page.waitForFunction((old) => {
      const v = document.querySelector('[data-screen-link] input')?.value ?? '';
      return v.includes('#k=') && !v.endsWith(old);
    }, MOCK_SCREEN_KEY, { timeout: 15_000 });
    const fresh = decodeURIComponent((await page.inputValue('[data-screen-link] input')).split('#k=')[1] ?? '');
    check((await snapshotOf(mock)).error === 'key', 'старый ключ всё ещё читает снимок');
    check(Array.isArray((await snapshotOf(mock, fresh)).staff), 'новый ключ не читает снимок');
    for (const id of TABS) {
      await openTab(page, id);
      const alert = await page.$$eval('[role="tabpanel"] [role="alert"]', (es) => es.filter((e) => e.checkVisibility()).map((e) => e.textContent?.trim() ?? '').filter(Boolean).join(' | '));
      check(alert === '', `после смены ключа вкладка ${id}: ${alert}`);
    }
  });

  await scenario('финал: дата позже импорта не проходит; провести (два вопроса) — покупка отклонена; отменить — снова можно', async ({ page, check, url, mock }) => {
    await login(page, url);
    await openTab(page, 'finale');
    const through = (await snapshotOf(mock)).paymentsImportedThrough;
    check(await page.inputValue('[data-finale-cutoff]') === through, 'по умолчанию не дата последней загрузки');
    await page.fill('[data-finale-cutoff]', '2026-12-29');
    check((await textOf(page, '[data-finale-preview]')).includes('Не позже последней загрузки оплат'), 'дата позже импорта принята');
    check(await page.isDisabled('[data-finale-run]'), 'кнопка финала активна при плохой дате');
    await page.fill('[data-finale-cutoff]', through);
    const preview = await textOf(page, '[data-finale-preview]');
    check(/Звезд/.test(preview) && /Лучший план — /.test(preview), `предпросмотр: ${preview.slice(0, 160)}`);
    await page.click('[data-finale-run]');
    await answerYes(page);
    await answerYes(page);
    await waitForText(page, '[data-status="finale"]', 'проведён');
    check((await snapshotOf(mock)).finale?.cutoff === through, 'финал не записан');
    const buy = await (await fetch(mock.url, {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'buy', group: 'СР1', groupPin: mock.groupPins['СР1'], shop: 'gift', item: 101, ref: 'check-after-finale' }),
    })).json();
    check(buy.error === 'finished', `покупка после финала: ${JSON.stringify(buy)}`);
    await page.click('[data-finale-clear]');
    await answerYes(page);
    await waitForText(page, '[data-status="finale"]', 'отменён');
    check((await snapshotOf(mock)).finale === null, 'финал не отменён');
    // после отмены лавка открыта: монет на подарок выдаём на моке и покупаем
    const post = async (body) => (await fetch(mock.url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })).json();
    const granted = await post({ action: 'grant', pin: MOCK_ADMIN_PIN, group: 'СР1', kind: 'coins', delta: 50, reason: 'проверка лавки', ref: 'check-grant-after-clear' });
    check(granted.ok === true, `выдача на моке: ${granted.error}`);
    const again = await post({ action: 'buy', group: 'СР1', groupPin: mock.groupPins['СР1'], shop: 'gift', item: 101, ref: 'check-after-clear' });
    check(again.ok === true, `покупка после отмены финала: ${again.error}`);
  });
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\nПровалов: ${failures.length}`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\ncheck:admin — всё зелёное');
