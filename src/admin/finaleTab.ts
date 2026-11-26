import type { Snapshot } from '@/data/api';
import { finaleOf } from '@/data/finale';
import type { AdminCtx } from './ctx';
import { ask, errorText, h, hhmm } from './dom';
import { cutoffDefault, cutoffError, finaleLines } from './finale';

const short = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/** Вкладка «Финал»: «Считать по», предпросмотр, провести (перечитать и спросить дважды) и отменить. */
export async function finaleTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snap: Snapshot = await ctx.snapshot();
  const root = h('div', {});
  const alert = h('p', { role: 'alert', 'data-alert': 'finale' });
  const status = h('p', { role: 'status', 'data-status': 'finale' });
  const preview = h('div', { class: 'preview', 'data-finale-preview': true });
  const lines = (cutoff: string) => finaleLines(snap, finaleOf(snap, cutoff));
  const showLines = (list: string[]) => preview.replaceChildren(...list.map((l) => h('p', {}, l)));

  async function reload(): Promise<void> {
    snap = await ctx.snapshot();
    paint();
  }

  function paint(): void {
    alert.textContent = '';
    if (snap.finale) {
      const { cutoff, at } = snap.finale;
      showLines(lines(cutoff));
      root.replaceChildren(h('section', { class: 'panel' },
        h('h2', {}, `Финал проведён: по ${short(cutoff)}, ${short(at)} в ${hhmm(at)}`),
        preview,
        h('div', { class: 'buttons' },
          h('button', { type: 'button', 'data-finale-replay': true, onclick: () => void replay() }, 'Повторить церемонию на экранах'),
          h('button', { type: 'button', class: 'danger', 'data-finale-clear': true, onclick: () => void clear() }, 'Отменить финал…')),
        alert, status));
      return;
    }
    const date = h('input', { type: 'date', 'data-finale-cutoff': true, value: cutoffDefault(snap) ?? '', oninput: () => update() });
    let shown: string[] = [];
    const update = () => {
      const error = cutoffError(snap, date.value);
      shown = error ? [] : lines(date.value);
      if (error) preview.replaceChildren(h('p', { role: 'alert' }, error));
      else showLines(shown);
      run.disabled = error !== null;
    };
    const run = h('button', {
      type: 'button',
      class: 'primary',
      'data-finale-run': true,
      onclick: async () => {
        alert.textContent = '';
        status.textContent = '';
        const cutoff = date.value;
        // перечитать: с открытия вкладки могли загрузить оплаты или купить игрушку
        try {
          snap = await ctx.snapshot();
        } catch (e) {
          alert.textContent = errorText(e);
          return;
        }
        const error = cutoffError(snap, cutoff);
        const fresh = error ? [] : lines(cutoff);
        if (error || fresh.join('\n') !== shown.join('\n')) {
          update();
          alert.textContent = error ?? 'Данные обновились — проверьте предпросмотр и нажмите ещё раз';
          return;
        }
        if (!(await ask(`Провести финал по ${short(cutoff)}? ${fresh[0]}. Экраны покажут церемонию, лавка закроется.`, 'Провести'))) return;
        if (!(await ask('Точно? Церемонию увидят все экраны сразу. Отменить финал можно, но показ уже случится.', 'Да, провести финал'))) return;
        try {
          await ctx.session.call('setFinale', { cutoff });
          await reload();
          status.textContent = 'Финал проведён';
        } catch (e) {
          alert.textContent = errorText(e);
        }
      },
    }, 'Провести финал…');
    update();
    root.replaceChildren(h('section', { class: 'panel' },
      h('h2', {}, 'Финал'),
      h('p', { class: 'muted' }, 'Звезду надевает группа с лучшим процентом плана оплат по дату «Считать по». Дата — не позже последней загрузки оплат из файла (оплаты за 29.12 приходят утром 30.12).'),
      h('label', {}, 'Считать по ', date),
      preview,
      h('div', { class: 'buttons' }, run),
      alert, status));
  }

  async function replay(): Promise<void> {
    try {
      await ctx.session.call('screenCommand', { kind: 'finale' });
      status.textContent = 'Церемония отправлена на экраны';
    } catch (e) {
      alert.textContent = errorText(e);
    }
  }

  async function clear(): Promise<void> {
    if (!(await ask('Отменить финал? Игра вернётся: лавка откроется, экраны уберут финальную картину.', 'Отменить финал'))) return;
    try {
      await ctx.session.call('clearFinale');
      await reload();
      status.textContent = 'Финал отменён, игра идёт';
    } catch (e) {
      alert.textContent = errorText(e);
    }
  }

  paint();
  return root;
}
