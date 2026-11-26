// ТОЛЬКО МОК: локальный сервер площади для разработки и проверок. Выполняет настоящий apps-script/Code.gs поверх подделок
// сервисов Google и кладёт в него демо (вымышленные сотрудники из src/demo/demo.ts). Админ-PIN здесь 1234, ключ экрана —
// тестовый: оба известны и описаны здесь, в боевом развёртывании их задаёт человек и сервер.
// Запуск: npm run mock-backend [-- демо]  → http://127.0.0.1:8788/exec ; часы идут от «сейчас» демо.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createServer as createVite } from 'vite';
import { loadBackend, TEST_SCREEN_KEY } from '../apps-script/test/gas-harness.mjs';

export const MOCK_ADMIN_PIN = '1234';
export const MOCK_SCREEN_KEY = TEST_SCREEN_KEY;

function must(result, what) {
  if (!result.ok) throw new Error(`Мок: не удалось ${what}: ${result.error}`);
  return result;
}

/** Кладёт демо в сервер его же действиями; покупки — прямо в лист, чтобы у них были свои даты и время. */
function seed(backend, s) {
  const as = (body) => ({ pin: MOCK_ADMIN_PIN, ...body });
  if (!s.staff.length) return;
  must(backend.post(as({ action: 'setStaff', staff: s.staff.map((e) => ({ name: e.name, shortName: e.shortName, group: e.group, baseLevel: e.baseLevel, paymentPlan: e.paymentPlan })) })), 'загрузить штат');
  const nameById = Object.fromEntries(s.staff.map((e) => [e.id, e.name]));
  const through = s.paymentsImportedThrough;
  if (through) {
    must(backend.post(as({ action: 'importFunnel', through, rows: s.funnel.map((r) => ({ name: nameById[r.employeeId], date: r.date, quality: r.quality, long: r.long })) })), 'загрузить воронку');
    must(backend.post(as({ action: 'importPayments', from: '2026-12-01', to: through, rows: s.payments })), 'загрузить оплаты');
  }
  for (const p of s.provisional) must(backend.post(as({ action: 'setProvisional', date: p.date, group: p.group, count: p.count })), 'внести платёжки');
  const idByName = Object.fromEntries(backend.get({}).staff.map((e) => [e.name, e.id]));
  backend.run('writeRows_', 'Purchases', s.purchases.map((p) => [
    String(p.id), p.at, p.date, p.group, p.shop, String(p.item), p.slot === null ? '' : String(p.slot),
    p.employeeId ? idByName[nameById[p.employeeId]] ?? '' : '', `seed-${p.id}`, '', '',
  ]));
  if (s.finale) must(backend.post(as({ action: 'setFinale', cutoff: s.finale.cutoff })), 'провести финал');
  backend.run('bump_', s.lastPaymentAt ? { lastPaymentAt: s.lastPaymentAt } : {});
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Поднимает мок на 127.0.0.1 (`port: 0` — свободный). Возвращает адрес `/exec`, PIN групп и `close()`. */
export async function startMockBackend({ port = 8788, demo = 'middle', realClock = true } = {}) {
  const vite = await createVite({ logLevel: 'error', appType: 'custom', server: { middlewareMode: true } });
  let snapshot;
  try {
    snapshot = (await vite.ssrLoadModule('/src/demo/demo.ts')).demoSnapshot(demo);
  } finally {
    await vite.close();
  }
  const startAt = Date.parse(snapshot.serverNow);
  const backend = loadBackend({ adminPin: MOCK_ADMIN_PIN, startAt, realClock: false });
  seed(backend, snapshot);
  const { groupPins } = must(backend.post({ action: 'setGroupPins', pin: MOCK_ADMIN_PIN }), 'выпустить PIN групп');
  // дальше часы мока идут вместе с настоящими, начиная с «сейчас» демо
  const started = Date.now();
  const tick = () => { if (realClock) backend.advance(Date.now() - started - (backend.now() - startAt)); };

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (url.pathname !== '/exec' || (req.method !== 'GET' && req.method !== 'POST')) return void res.writeHead(404).end();
    tick();
    const result = req.method === 'GET' ? backend.get({ k: '', ...Object.fromEntries(url.searchParams) }) : backend.postRaw(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(result));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/exec`,
    groupPins,
    backend,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = process.argv[2] ?? 'middle';
  const mock = await startMockBackend({ port: Number(process.env.PORT ?? 8788), demo });
  console.log(`Мок (ТОЛЬКО МОК, демо «${demo}», админ-PIN ${MOCK_ADMIN_PIN}): ${mock.url}`);
  console.log(`Площадь: http://127.0.0.1:5173/?backend=${mock.url}#k=${MOCK_SCREEN_KEY}`);
  console.log('PIN групп:', JSON.stringify(mock.groupPins));
}
