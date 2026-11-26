// Сценарий страницы РГ на моке: npm run mock-backend и npm run dev, затем node tools/check-rg.mjs <папка снимков> <PIN группы> (G=СР3 — группа). Нужны деньги у группы: выдайте их на моке.
import { chromium } from 'playwright-core';
const [out, pin] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome', headless: true });
const bad = [];
const log = (...a) => console.log(...a);
async function scenario(viewport, tag) {
  const p = await b.newPage({ viewport });
  p.on('pageerror', (e) => bad.push(`${tag} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') bad.push(`${tag} console ${m.text()}`); });
  await p.goto('http://127.0.0.1:5173/rg.html?backend=http://127.0.0.1:8788/exec');
  await p.selectOption('select', process.env.G ?? 'СР1');
  await p.fill('input[type=password]', pin);
  await p.click('button[type=submit]');
  await p.waitForSelector('.wallet', { timeout: 30000 });
  await p.waitForSelector('.slot', { timeout: 30000 });
  await p.screenshot({ path: `${out}/rg-${tag}-1.png`, fullPage: true });
  const before = await p.textContent('.pay .big');
  await p.click('text=Пришла платёжка');
  await p.waitForFunction((n) => document.querySelector('.pay .big')?.textContent !== n, before, { timeout: 30000 });
  log(tag, 'платёжки', before, '→', await p.textContent('.pay .big'));
  const hungBefore = await p.textContent('.mine, .panel:last-child h2');
  await p.locator('.slot').first().click();
  await p.selectOption('.who select', { index: 1 });
  const buyBtn = p.locator('.panel').nth(1).locator('.card button.primary').first();
  await buyBtn.click();
  await p.waitForSelector('dialog.ask[open]');
  log(tag, 'вопрос:', await p.textContent('dialog.ask p'));
  await p.click('dialog.ask button.primary'); // раньше 500 мс: не должно сработать
  log(tag, 'ранний щелчок закрыл окно?', !(await p.$('dialog.ask[open]')));
  await p.waitForTimeout(600);
  await p.click('dialog.ask button.primary');
  await p.waitForFunction((t) => document.querySelector('.panel:last-child h2')?.textContent !== t, await p.textContent('.panel:last-child h2'), { timeout: 30000 });
  log(tag, 'игрушек:', await p.textContent('.panel:last-child h2'), '| последняя:', await p.locator('.mine li').last().textContent());
  for (const [i, name] of [[2, 'подарок'], [3, 'чердак'], [4, 'подвал']]) {
    const btn = p.locator('.panel').nth(i).locator('.card button.primary').first();
    if (!(await btn.count())) { log(tag, name, ': купить не на что'); continue; }
    await btn.click(); await p.waitForSelector('dialog.ask[open]');
    const q = await p.textContent('dialog.ask p');
    await p.waitForTimeout(600); await p.click('dialog.ask button.primary');
    await p.waitForTimeout(2500);
    log(tag, name, ':', q, '| статус:', await p.textContent('.status'));
  }
  await p.screenshot({ path: `${out}/rg-${tag}-2.png`, fullPage: false });
  const wide = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  log(tag, 'горизонтальная прокрутка:', wide);
  await p.close();
}
await scenario({ width: 390, height: 844 }, 'phone');
await scenario({ width: 1366, height: 768 }, 'laptop');
log('ошибки:', JSON.stringify(bad));
await b.close();
