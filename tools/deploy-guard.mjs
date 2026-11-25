// Сторож публикации: этот проект выкладывается только в sales-new-year и не знает про адреса «Питомцев».
// Запуск: npm run guard (перед каждым push). Печатает причины и выходит с кодом 1.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...a) => execFileSync('git', ['-c', 'core.quotepath=false', ...a], { encoding: 'utf8' }).trim();
const bad = [];
let origin = '';
try { origin = git('remote', 'get-url', 'origin'); } catch { bad.push('нет remote origin'); }
if (origin && !/[/:]sales-new-year(\.git)?$/.test(origin)) bad.push('origin смотрит не на sales-new-year');
const FOREIGN = /sales-pets|petsReloadedFor|tamagochi-sales/;
for (const f of git('ls-files').split('\n').filter((f) => /\.(ts|mjs|js|gs|html|json|yml|css)$/.test(f) && f !== 'tools/deploy-guard.mjs')) {
  if (FOREIGN.test(readFileSync(f, 'utf8'))) bad.push(`след чужого проекта: ${f}`);
}
if (bad.length) { console.error('Публиковать нельзя:\n- ' + bad.join('\n- ')); process.exit(1); }
console.log('сторож публикации: чисто');
