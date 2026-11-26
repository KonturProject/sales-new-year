import { serverToday, type Snapshot } from '@/data/api';
import { buildFacts, grinchOf } from '@/data/facts';
import type { GrinchCommand } from '@/engine/grinch';
import { GROUPS } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { errorText, h, hhmm } from './dom';
import { grinchLines, QUIET_MAX, QUIET_MIN, quietError } from './grinch';

const COMMAND_TITLE: Record<GrinchCommand['kind'], string> = { steal: 'Украсть игрушку', garland: 'Погасить гирлянду', return: 'Вернуть всё' };

/** Вкладка «Гринч»: что он делает сейчас, кнопки пакостей и возврата, «Сам по себе» и «Тишина». */
export async function grinchTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snap: Snapshot = await ctx.snapshot();
  const alert = h('p', { role: 'alert', 'data-alert': 'grinch' });
  const status = h('p', { role: 'status', 'data-status': 'grinch' });
  const now = h('div', { class: 'preview', 'data-grinch-now': true });
  const recent = h('ul', { class: 'log', 'data-grinch-commands': true });

  function paint(): void {
    const st = grinchOf(snap, buildFacts(snap, serverToday(snap)), snap.serverNow);
    now.replaceChildren(...grinchLines(st, snap.grinch).map((l) => h('p', {}, l)));
    const last = [...snap.grinch.commands].reverse().slice(0, 5);
    recent.replaceChildren(...(last.length ? last.map((c) => h('li', {}, `${hhmm(c.at)} · ${COMMAND_TITLE[c.kind]}`)) : [h('li', { class: 'muted' }, 'Команд пока не было')]));
  }

  async function run(action: string, body: object, done: string): Promise<void> {
    alert.textContent = '';
    status.textContent = '';
    try {
      await ctx.session.call(action, body);
      snap = await ctx.snapshot();
      paint();
      status.textContent = done;
    } catch (e) {
      alert.textContent = errorText(e);
    }
  }

  const command = (kind: GrinchCommand['kind']) =>
    h('button', { type: 'button', 'data-grinch': kind, onclick: () => void run('grinchCommand', { kind }, `${COMMAND_TITLE[kind]}: отправлено`) }, COMMAND_TITLE[kind]);

  const snowGroup = h('select', { 'aria-label': 'В чей домик', 'data-snowball-group': true }, ...GROUPS.map((g) => h('option', { value: g }, g)));
  const snowball = h('button', {
    type: 'button',
    'data-snowball': true,
    onclick: () => void run('screenCommand', { kind: 'snowball', group: snowGroup.value }, `Снежок в домик ${snowGroup.value}: отправлено`),
  }, 'Снежок в домик');

  const auto = h('input', { type: 'checkbox', 'data-grinch-auto': true });
  auto.checked = snap.grinch.auto;
  const quiet = h('input', { type: 'number', min: QUIET_MIN, max: QUIET_MAX, step: 1, value: snap.grinch.quietMin, inputmode: 'numeric', 'data-grinch-quiet': true });
  // своя проверка вместо браузерной: сообщение то же, что у сервера, и рядом с формой
  const settings = h('form', {
    'data-grinch-settings': true,
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const error = quietError(quiet.value);
      if (error) {
        alert.textContent = error;
        status.textContent = '';
        return;
      }
      void run('setGrinch', { auto: auto.checked, quietMin: Number(quiet.value.trim()) }, 'Настройки Гринча сохранены');
    },
  },
  h('label', {}, 'Сам по себе ', auto),
  h('label', {}, 'Тишина, минут ', quiet),
  h('button', { type: 'submit' }, 'Сохранить'));

  paint();
  return h('div', {},
    h('section', { class: 'panel' },
      h('h2', {}, 'Гринч сейчас'),
      now,
      h('p', { class: 'muted' }, 'Сам по себе он пакостит в рабочий день с 10:00 до 18:00, если по филиалу нет новых платёжек дольше «тишины». Любая новая платёжка возвращает всё. Цифры и места не меняются никогда — только картинка.'),
      alert, status),
    h('section', { class: 'panel' },
      h('h2', {}, 'Руками'),
      h('div', { class: 'buttons' }, command('steal'), command('garland'), command('return')),
      h('div', { class: 'buttons' }, snowGroup, snowball),
      h('p', { class: 'muted' }, 'Снежок — только сцена на экране, 5 секунд.'),
      h('h3', {}, 'Последние команды'),
      recent),
    h('section', { class: 'panel' },
      h('h2', {}, 'Настройки'),
      settings));
}
