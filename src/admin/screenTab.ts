import { screenKey, type ScreenCommand, type Snapshot } from '@/data/api';
import { GROUPS } from '@/engine/types';
import type { AdminCtx } from './ctx';
import { ask, errorText, h, hhmm } from './dom';
import { screenLink } from './screen';

const KIND_TITLE: Record<ScreenCommand['kind'], string> = {
  replay: 'Повторить последнюю покупку', salute: 'Салют', opening: 'Сцена открытия', snowball: 'Снежок', finale: 'Церемония финала',
};

/** Вкладка «Экран»: сцены по кнопке на всех экранах и ключ экрана (ссылка показывается только по нажатию). */
export async function screenTab(ctx: AdminCtx): Promise<HTMLElement> {
  let snap: Snapshot = await ctx.snapshot();
  const alert = h('p', { role: 'alert', 'data-alert': 'screen' });
  const status = h('p', { role: 'status', 'data-status': 'screen' });
  const recent = h('ul', { class: 'log', 'data-screen-commands': true });
  const paint = () => {
    const last = [...snap.commands].sort((a, b) => b.id - a.id);
    recent.replaceChildren(...(last.length
      ? last.map((c) => h('li', {}, `${hhmm(c.at)} · ${KIND_TITLE[c.kind]}${c.group ? ` · ${c.group}` : ''}`))
      : [h('li', { class: 'muted' }, 'За последние 10 минут команд не было')]));
  };

  const send = async (kind: ScreenCommand['kind']) => {
    alert.textContent = '';
    status.textContent = '';
    try {
      await ctx.session.call('screenCommand', { kind });
      snap = await ctx.snapshot();
      paint();
      status.textContent = `${KIND_TITLE[kind]}: отправлено на экраны`;
    } catch (e) {
      alert.textContent = errorText(e);
    }
  };
  const button = (kind: ScreenCommand['kind']) => h('button', { type: 'button', 'data-screen': kind, onclick: () => void send(kind) }, KIND_TITLE[kind]);

  // ссылка экрана: только по нажатию, в поле для копирования; уходит вместе с вкладкой, в консоль не пишется
  const linkBox = h('div', { class: 'screen-link', 'data-screen-link': true });
  const keyAlert = h('p', { role: 'alert', 'data-alert': 'key' });
  const showLink = (key: string, note: string) => {
    const field = h('input', { type: 'text', readonly: true, 'aria-label': 'Ссылка для экрана', value: screenLink(location.href, key) });
    const copy = h('button', {
      type: 'button',
      'data-copy-link': true,
      onclick: () => {
        void navigator.clipboard.writeText(field.value).then(
          () => { copy.textContent = 'Скопировано'; },
          () => { field.select(); copy.textContent = 'Выделено: Ctrl+C'; },
        );
      },
    }, 'Копировать');
    linkBox.replaceChildren(field, copy, h('p', { class: 'muted' }, note));
  };
  const current = h('button', {
    type: 'button',
    'data-show-link': true,
    onclick: () => {
      keyAlert.textContent = '';
      const key = screenKey.get();
      if (!key) keyAlert.textContent = 'Ключа нет: выйдите и войдите снова';
      else showLink(key, 'Откройте ссылку на ТВ или ноутбуке: экран запомнит ключ и уберёт его из адреса.');
    },
  }, 'Показать ссылку экрана');
  const rotate = h('button', {
    type: 'button',
    class: 'danger',
    'data-new-key': true,
    onclick: async () => {
      keyAlert.textContent = '';
      const yes = await ask('Сменить ключ экрана? Старые ссылки перестанут работать сразу: на всех ТВ и ноутбуках нужно открыть новую. РГ войдут на свою страницу заново.', 'Сменить ключ');
      if (!yes) return;
      try {
        const r = await ctx.session.call<{ screenKey: string }>('setScreenKey');
        screenKey.set(r.screenKey);
        showLink(r.screenKey, 'Новый ключ. Скопируйте ссылку сейчас и откройте её на экранах; прежние ссылки уже не работают.');
      } catch (e) {
        keyAlert.textContent = errorText(e);
      }
    },
  }, 'Новый ключ…');

  paint();
  return h('div', {},
    h('section', { class: 'panel' },
      h('h2', {}, 'Сцены на экранах'),
      h('p', { class: 'muted' }, 'Каждый экран покажет сцену в течение 15 секунд (по ближайшему опросу). Команда живёт 10 минут.'),
      h('div', { class: 'buttons' }, button('replay'), button('salute'), button('opening')),
      alert, status,
      h('h3', {}, 'Отправлено'),
      recent),
    h('section', { class: 'panel' },
      h('h2', {}, 'Ключ экрана'),
      h('p', { class: 'muted' }, `Без ключа экран площади не откроется: в данных ФИО. Ключ один на все экраны и на страницы РГ (${GROUPS.length} групп).`),
      h('div', { class: 'buttons' }, current, rotate),
      keyAlert,
      linkBox));
}
