import { describe, expect, test } from 'vitest';
import { grinchLines, quietError } from './grinch';
import { screenLink } from './screen';

describe('quietError: «Тишина, минут»', () => {
  test('целое от 30 до 480', () => {
    for (const ok of ['30', '120', '480', ' 90 ']) expect(quietError(ok), ok).toBeNull();
    for (const bad of ['29', '481', '', '90,5', 'час', '-30']) expect(quietError(bad), bad).toBe('Тишина: целое число минут от 30 до 480');
  });
});

describe('grinchLines: что Гринч делает сейчас', () => {
  const base = { since: '2026-12-10T12:40:00+03:00', pranks: 0 as const, stolen: [], garlandOff: null, asleep: false };

  test('спит вне 10–18 и в выходной', () => {
    expect(grinchLines({ ...base, asleep: true }, { auto: true, quietMin: 120 })).toEqual(['Гринч спит: не рабочее время']);
  });

  test('караулит: сам по себе, тишина и с какого времени', () => {
    expect(grinchLines(base, { auto: true, quietMin: 120 })).toEqual(['Сам по себе: да, тишина 120 мин', 'Тишина по филиалу с 12:40', 'Пакостей нет']);
    expect(grinchLines(base, { auto: false, quietMin: 90 })[0]).toBe('Сам по себе: нет (только по кнопкам), тишина 90 мин');
  });

  test('пакости: украденные игрушки и погашенная гирлянда', () => {
    expect(grinchLines({ ...base, pranks: 2, stolen: [4, 9], garlandOff: null }, { auto: true, quietMin: 120 }).at(-1)).toBe('Украдено игрушек: 2');
    expect(grinchLines({ ...base, pranks: 2, stolen: [4], garlandOff: 1 }, { auto: true, quietMin: 120 }).at(-1)).toBe('Украдено игрушек: 1 · погашена гирлянда яруса 1');
  });
});

describe('screenLink: ссылка для экрана с новым ключом', () => {
  test('из адреса админки: корень сайта и ключ после #', () => {
    expect(screenLink('https://konturproject.github.io/sales-new-year/admin.html?x=1#t', 'k-123')).toBe('https://konturproject.github.io/sales-new-year/#k=k-123');
    expect(screenLink('http://localhost:5173/admin.html', 'abc')).toBe('http://localhost:5173/#k=abc');
  });

  test('backend из адреса сохраняется: экран на моке смотрит туда же', () => {
    expect(screenLink('http://localhost:5173/admin.html?backend=http%3A%2F%2F127.0.0.1%3A8788%2Fexec', 'abc'))
      .toBe('http://localhost:5173/?backend=http%3A%2F%2F127.0.0.1%3A8788%2Fexec#k=abc');
  });
});
