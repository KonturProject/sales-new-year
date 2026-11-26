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
const TABS = ['results', 'payments', 'import', 'staff', 'norms', 'pins'];
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
