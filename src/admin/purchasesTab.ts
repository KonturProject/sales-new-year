import type { Snapshot } from '@/data/api';
import { GROUPS, type GroupCode } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { ask, errorText, h } from './dom';
import { cancelBody, CURRENCY_TITLE, grantPlan, purchaseLines } from './purchases';
import { signed } from './resultsText';

interface Private {
  cancelReasons: Record<string, string>;
  grantReasons: Record<string, string>;
}

const option = (value: string, text: string) => h('option', { value }, text);
const newRef = () => crypto.randomUUID();
/** Сколько последних покупок видно сразу; остальные — по кнопке. */
const FIRST = 40;

/** Вкладка «Покупки»: журнал с отменой по причине, выдача и изъятие монет, снежинок, ключиков. */
export async function purchasesTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snap: Snapshot;
  let priv: Private;
  const load = async () => {
    [snap, priv] = await Promise.all([ctx.snapshot(), ctx.session.call<Private>('getPrivate')]);
  };
  await load();

  // ── журнал покупок
  const filter = h('select', { 'aria-label': 'Группа', 'data-purchases-filter': true, onchange: () => paintList() },
    option('', 'Все группы'), ...GROUPS.map((g) => option(g, g)));
  const list = h('ul', { class: 'log', 'data-purchases': true });
  const listAlert = h('p', { role: 'alert', 'data-alert': 'cancel' });
  const listStatus = h('p', { role: 'status', 'data-status': 'cancel' });

  let all = false;
  function paintList(): void {
    const every = purchaseLines(snap, priv.cancelReasons, (filter.value || undefined) as GroupCode | undefined);
    const lines = all ? every : every.slice(0, FIRST);
    const more = every.length > lines.length
      ? h('li', {}, h('button', { type: 'button', 'data-purchases-all': true, onclick: () => { all = true; paintList(); } }, `Показать все (${every.length})`))
      : null;
    list.replaceChildren(...(lines.length ? lines.map((l) => {
      const li = h('li', { class: l.cancelled ? 'cancelled' : '', 'data-purchase': l.id }, h('span', {}, l.text));
      if (l.note) li.append(h('span', { class: 'note' }, l.note));
      else li.append(h('button', { type: 'button', class: 'danger', 'data-cancel-open': l.id, onclick: () => openCancel(li, l.id, l.text) }, 'Отменить…'));
      return li;
    }) : [h('li', { class: 'muted' }, 'Покупок пока нет')]));
    if (more) list.append(more);
  }

  function openCancel(li: HTMLElement, id: number, text: string): void {
    if (li.querySelector('form')) return;
    const reason = h('input', { type: 'text', maxlength: 200, placeholder: 'Причина отмены', 'aria-label': 'Причина отмены', 'data-cancel-reason': id });
    const form = h('form', {
      'data-cancel': id,
      onsubmit: (e) => {
        e.preventDefault();
        void cancel(id, text, reason.value);
      },
    }, reason, h('button', { type: 'submit' }, 'Отменить покупку'));
    li.append(form);
    reason.focus();
  }

  async function cancel(id: number, text: string, reason: string): Promise<void> {
    listAlert.textContent = '';
    listStatus.textContent = '';
    const plan = cancelBody(id, reason);
    if ('error' in plan) {
      listAlert.textContent = plan.error;
      return;
    }
    if (!(await ask(`Отменить ${text}? Вещь уйдёт с площади, валюта вернётся группе, место освободится. Запись останется в журнале с причиной.`, 'Отменить покупку'))) return;
    const done = async () => {
      await load();
      paintList();
      paintGrants();
      listStatus.textContent = `Покупка №${id} отменена`;
    };
    try {
      await ctx.session.call('cancelPurchase', plan.body);
      await done();
    } catch (e) {
      // ответ мог потеряться после записи: повтор тогда отказ, а покупка уже отменена — проверяем по свежему снимку
      try {
        if ((await ctx.snapshot()).purchases.some((p) => p.id === id && p.cancelledAt !== null)) return void (await done());
      } catch { /* остаётся исходная ошибка */ }
      listAlert.textContent = errorText(e);
    }
  }

  // ── выдача и изъятие
  const grantGroup = h('select', { 'data-grant': 'group', 'aria-label': 'Группа', oninput: () => preview() }, option('', 'Группа…'), ...GROUPS.map((g) => option(g, g)));
  const grantKind = h('select', { 'data-grant': 'kind', 'aria-label': 'Что', oninput: () => preview() },
    ...(['coins', 'flakes', 'keys'] as const).map((k) => option(k, CURRENCY_TITLE[k])));
  const grantDelta = h('input', { type: 'text', inputmode: 'numeric', 'data-grant': 'delta', placeholder: '5 или −5', oninput: () => preview() });
  const grantReason = h('input', { type: 'text', maxlength: 200, 'data-grant': 'reason', placeholder: 'За что', oninput: () => preview() });
  const grantPreview = h('p', { class: 'muted', 'data-grant-preview': true });
  const grantAlert = h('p', { role: 'alert', 'data-alert': 'grant' });
  const grantStatus = h('p', { role: 'status', 'data-status': 'grant' });
  /** ключ повтора живёт до успеха: потерянный ответ и повторное нажатие не выдадут дважды */
  let ref = newRef();
  const form = () => ({ group: grantGroup.value, kind: grantKind.value, delta: grantDelta.value, reason: grantReason.value });
  function preview(): void {
    ref = newRef();
    const p = grantPlan(snap, form());
    grantPreview.textContent = 'preview' in p ? `Станет: ${p.preview}` : '';
  }

  async function grant(): Promise<void> {
    grantAlert.textContent = '';
    grantStatus.textContent = '';
    const p = grantPlan(snap, form());
    if ('error' in p) {
      grantAlert.textContent = p.error;
      return;
    }
    const verb = p.body.delta > 0 ? 'Выдать' : 'Забрать';
    if (!(await ask(`${verb}: ${p.preview}. Причина: «${p.body.reason}».`, verb))) return;
    try {
      await ctx.session.call('grant', { ...p.body, ref });
      ref = newRef();
      await load();
      grantDelta.value = '';
      grantReason.value = '';
      grantPreview.textContent = '';
      grantStatus.textContent = `Готово: ${p.preview}`;
      paintGrants();
    } catch (e) {
      grantAlert.textContent = errorText(e);
    }
  }

  const grantForm = h('form', {
    'data-grant-form': true,
    onsubmit: (e) => {
      e.preventDefault();
      void grant();
    },
  },
  h('label', {}, 'Группа ', grantGroup),
  h('label', {}, 'Что ', grantKind),
  h('label', {}, 'Сколько ', grantDelta),
  h('label', {}, 'Причина ', grantReason),
  grantPreview,
  h('button', { type: 'submit' }, 'Записать'),
  grantAlert,
  grantStatus);

  const grants = h('ul', { class: 'log', 'data-grants': true });
  function paintGrants(): void {
    const rows = [...snap.grants].sort((a, b) => b.id - a.id);
    grants.replaceChildren(...(rows.length ? rows.map((g) => h('li', {},
      h('span', {}, `${g.date.slice(8)}.${g.date.slice(5, 7)} · ${g.group} · ${CURRENCY_TITLE[g.kind]} ${signed(g.delta)}`),
      h('span', { class: 'muted' }, priv.grantReasons[String(g.id)] ?? ''))) : [h('li', { class: 'muted' }, 'Выдач пока нет')]));
  }

  paintList();
  paintGrants();
  return h('div', {},
    h('section', { class: 'panel' },
      h('h2', {}, 'Покупки'),
      h('p', { class: 'muted' }, 'Новые сверху. Отмена убирает вещь и возвращает валюту группе; запись остаётся с причиной. Причины видны только здесь.'),
      h('div', { class: 'toolbar' }, filter),
      listAlert, listStatus, list),
    h('section', { class: 'panel' },
      h('h2', {}, 'Выдать или забрать'),
      h('p', { class: 'muted' }, 'Монеты, снежинки или ключики группе; минус — забрать. На процент плана и звезду не влияет.'),
      grantForm,
      h('h3', {}, 'Выдачи'),
      grants));
}
