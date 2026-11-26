import '@fontsource-variable/nunito';
import '@fontsource/marmelad';
import './rg.css';
import { h, newVersionSlot } from '@/admin/dom';
import { api, resolvePollMs, screenKey, type Snapshot } from '@/data/api';
import { buildFacts, type Facts } from '@/data/facts';
import { createStore } from '@/data/store';
import { CATALOG, CURRENCY_OF, tierOfSlot, type CatalogItem, type Currency } from '@/engine/catalog';
import { GROUPS, type GroupCode } from '@/engine/types';
import { ART, iconPath } from '@/square/art';
import { treeSlots, type SlotPoint } from '@/square/slots';
import { amount, askAccepted, buyError, confirmText, employeesOf, giftCards, houseCards, paymentState, treeCards, type Card } from './model';
import { createSpender } from './spend';

const NAMES: Record<GroupCode, string> = { СР1: 'Лев', СР2: 'Скрудж', СР3: 'Гринч', СР5: 'Йода', СР6: 'Знайка', СР9: 'Смурфетта' };
const CATALOG_BY_CODE = new Map(CATALOG.map((i) => [i.code, i]));
const CURRENCY_TITLE: Record<Currency, string> = { coins: 'Монеты', flakes: 'Снежинки', keys: 'Ключики' };

const root = document.getElementById('app')!;
const updateSlot = newVersionSlot();
const store = createStore({
  fetchSnapshot: (since) => api.get(since),
  pollMs: resolvePollMs(location.search, { dev: import.meta.env.DEV, hostname: location.hostname }),
});

function showLogin(message = ''): void {
  const group = h('select', { 'aria-label': 'Группа' }, ...GROUPS.map((g) => h('option', { value: g }, `${g} · ${NAMES[g]}`)));
  // поле PIN без name: браузер не предлагает его сохранить; PIN живёт только в памяти страницы
  const input = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', required: true, 'aria-label': 'PIN' });
  const alert = h('p', { role: 'alert' }, message);
  const form = h('form', {
    class: 'login',
    onsubmit: (e) => {
      e.preventDefault();
      const groupPin = input.value;
      input.value = '';
      alert.textContent = '';
      const code = group.value as GroupCode;
      api.post<{ screenKey: string }>('groupLogin', { group: code, groupPin }).then((r) => {
        screenKey.set(r.screenKey);
        showWork(code, groupPin);
      }, (err) => { alert.textContent = buyError(err).replace('PIN сменился. Войдите заново', 'Неверный PIN'); });
    },
  },
  h('img', { src: ART.tree, alt: '', class: 'login-tree' }),
  h('h1', {}, 'Новогодняя площадь'),
  h('p', { class: 'muted' }, 'Страница руководителя группы'),
  h('label', {}, 'Группа', group),
  h('label', {}, 'PIN', input),
  h('button', { type: 'submit', class: 'primary' }, 'Войти'),
  alert);
  root.replaceChildren(updateSlot, form);
  input.focus();
}

/** Окно вопроса без системных диалогов; ответ раньше 500 мс не засчитывается. */
function ask(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const shownAt = performance.now();
    const close = (yes: boolean) => { dialog.close(); dialog.remove(); resolve(yes); };
    const dialog = h('dialog', { class: 'ask' },
      h('p', {}, text),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'primary', onclick: () => { if (askAccepted(shownAt, performance.now())) close(true); } }, 'Да'),
        h('button', { type: 'button', onclick: () => close(false) }, 'Отмена')));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

let treeGeometry: Promise<{ slots: SlotPoint[]; w: number; h: number }> | null = null;
/** Места на картинке ёлки — те же, что на экране площади. */
function geometry() {
  treeGeometry ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      const slots = treeSlots({ width: c.width, height: c.height, solid: (x, y) => x >= 0 && y >= 0 && x < c.width && y < c.height && px[(y * c.width + x) * 4 + 3]! > 200 });
      resolve({ slots, w: c.width, h: c.height });
    };
    img.onerror = reject;
    img.src = ART.tree;
  });
  return treeGeometry;
}

function showWork(group: GroupCode, groupPin: string): void {
  let slot: number | null = null;
  let employee = '';
  let note = '';
  const spender = createSpender<string>({
    send: (key, ref) => {
      const [kind, a, b] = key.split(':');
      if (kind === 'pay') return api.post('addPayment', { group, groupPin, delta: Number(a), ref });
      return api.post('buy', { group, groupPin, shop: kind, item: Number(a), slot: b ? Number(b) : null, employeeId: kind === 'tree' && employee ? employee : null, ref });
    },
  });

  const status = h('p', { class: 'status', role: 'status' });
  const body = h('div', { class: 'work' });
  root.replaceChildren(updateSlot,
    h('header', { class: 'bar' },
      h('img', { src: iconPath(`mascot-sr${group.slice(2)}`), alt: '' }),
      h('h1', {}, `${group} · ${NAMES[group]}`),
      h('button', { type: 'button', onclick: () => { store.stop(); showLogin(); } }, 'Выйти')),
    status, body);

  async function run(key: string, question: string | null): Promise<void> {
    if (spender.busy) return;
    if (question && !(await ask(question))) return;
    note = '';
    try {
      await spender.spend(key);
      if (key.startsWith('tree:')) slot = null;
    } catch (e) {
      note = buyError(e);
    }
    await store.refresh();
    const s = store.current();
    if (s) render(s);
  }

  const icon = (item: CatalogItem) => h('img', { src: iconPath(item.art), alt: '', loading: 'lazy' });
  const price = (item: CatalogItem) => amount(item.price, CURRENCY_OF[item.shop]);
  function cardEl(c: Card, onBuy: () => void, disabled = false): HTMLElement {
    const label = c.state === 'owned' ? 'Уже стоит' : c.state === 'closed' ? 'Лавка закрыта' : c.state === 'poor' ? `Не хватает ${c.lack}` : 'Выбрать';
    return h('div', { class: `card ${c.state}` }, icon(c.item),
      h('div', { class: 'name' }, c.item.name), h('div', { class: 'price' }, price(c.item)),
      h('button', { type: 'button', class: c.state === 'buy' ? 'primary' : '', disabled: c.state !== 'buy' || disabled || spender.busy, onclick: onBuy }, label));
  }

  function render(s: Snapshot): void {
    const f: Facts = buildFacts(s, s.serverNow.slice(0, 10));
    const view = f.groups[group];
    status.textContent = note;

    const wallet = h('section', { class: 'wallet' }, ...(['coins', 'flakes', 'keys'] as Currency[]).map((c) =>
      h('div', { class: `coin ${c}` }, h('b', {}, String(Math.max(0, view.balance[c]))), h('span', {}, CURRENCY_TITLE[c]))));

    const pay = paymentState(s, group);
    const payments = h('section', { class: 'panel' },
      h('h2', {}, 'Платёжки сегодня'),
      h('div', { class: 'pay' },
        h('b', { class: 'big' }, String(pay.today)),
        h('button', { type: 'button', class: 'primary', disabled: !pay.canAdd || spender.busy, onclick: () => void run('pay:1', null) }, 'Пришла платёжка'),
        h('button', { type: 'button', disabled: !pay.canRemove || spender.busy, onclick: () => void run('pay:-1', 'Убрать последнюю платёжку?') }, 'Убрать последнюю')),
      pay.reason ? h('p', { class: 'muted' }, pay.reason) : h('p', { class: 'muted' }, 'Утром файл оплат заменит эти числа официальными.'));

    const tree = treeCards(s, f, group);
    if (slot !== null && !tree.free.includes(slot)) slot = null;
    const people = employeesOf(s, group);
    const picker = h('div', { class: 'tree-pick' }, h('img', { src: ART.tree, alt: 'Ёлка' }));
    void geometry().then((g) => {
      for (const n of tree.free) {
        const p = g.slots[n - 1]!;
        picker.append(h('button', {
          type: 'button', class: `slot${slot === n ? ' on' : ''}`, 'aria-label': `Место ${n}`,
          style: `left:${(100 * p.x) / g.w}%;top:${(100 * p.y) / g.h}%`,
          onclick: () => { slot = n; render(s); },
        }));
      }
    });
    const shopEl = h('section', { class: 'panel' },
      h('h2', {}, 'Лавка игрушек'),
      tree.tier === null ? h('p', {}, 'Ёлка наряжена целиком! Монеты можно потратить на подарки под ёлку.')
        : h('p', { class: 'muted' }, `Открыт ${tree.tier}-й ярус, свободно мест: ${tree.free.length}. ${slot === null ? 'Нажмите место на ёлке.' : `Выбрано место ${slot}.`}`),
      tree.tier === null ? null : picker,
      tree.tier === null ? null : h('label', { class: 'who' }, 'Посвятить сотруднику',
        h('select', { onchange: (e) => { employee = (e.target as HTMLSelectElement).value; } },
          h('option', { value: '' }, 'никому'), ...people.map((e) => h('option', { value: e.id, selected: e.id === employee }, e.shortName || e.name)))),
      h('div', { class: 'cards' }, ...tree.options.map((c) => cardEl(c, () => {
        const who = people.find((e) => e.id === employee);
        void run(`tree:${c.item.code}:${slot}`, confirmText(c.item, { tier: tierOfSlot(slot!), employee: who ? who.shortName || who.name : undefined }));
      }, slot === null))));

    const gifts = h('section', { class: 'panel' }, h('h2', {}, 'Подарки под ёлку'),
      h('div', { class: 'cards' }, ...giftCards(s, f, group).map((c) => cardEl(c, () => void run(`gift:${c.item.code}`, confirmText(c.item, {}))))));

    const house = (shop: 'attic' | 'cellar', title: string, hint: string) => h('section', { class: 'panel' }, h('h2', {}, title), h('p', { class: 'muted' }, hint),
      ...houseCards(s, f, group, shop).map((p) => h('div', { class: 'place' },
        h('h3', {}, p.title, p.owned ? h('span', { class: 'muted' }, ` · сейчас: ${p.owned.name}`) : null),
        h('div', { class: 'cards' }, ...p.options.map((c) => cardEl(c, () => void run(`${shop}:${c.item.code}`, confirmText(c.item, { replaces: p.owned }))))))));

    const mine = f.tree.hung.filter((x) => x.group === group);
    const nameOf = new Map(s.staff.map((e) => [e.id, e.shortName || e.name]));
    const list = h('section', { class: 'panel' }, h('h2', {}, `Наши игрушки на ёлке: ${mine.length}`),
      mine.length ? h('ul', { class: 'mine' }, ...mine.map((x) => {
        const item = CATALOG_BY_CODE.get(x.item)!;
        return h('li', {}, icon(item), h('span', {}, item.name), h('span', { class: 'muted' }, ` · ${tierOfSlot(x.slot)}-й ярус${x.employeeId ? ` · ${nameOf.get(x.employeeId) ?? ''}` : ''}`));
      })) : h('p', { class: 'muted' }, 'Пока ни одной. Первая — самая памятная!'));

    body.replaceChildren(wallet, payments, shopEl, gifts,
      house('attic', 'Чердак', 'Снежинки дают счета от 6 минут. Лёгкие украшения на фасад.'),
      house('cellar', 'Подвал', 'Ключики дают счета от 20 минут. Большие украшения во двор.'),
      list);
  }

  store.subscribe(render);
  store.onStatus((st) => {
    if (st === 'offline') status.textContent = 'Нет связи с сервером. Последние данные на экране.';
    else if (st === 'key') showLogin('Ключ площади сменился. Войдите заново.');
    else if (status.textContent?.startsWith('Нет связи')) status.textContent = note;
  });
  store.start();
  void store.refresh();
}

showLogin();
