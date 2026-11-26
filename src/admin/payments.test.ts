import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/data/api';
import { type PaymentLogEntry, paymentLogLines, provisionalChanges, provisionalToday } from './payments';

const snapshot = {
  serverNow: '2026-11-12T10:00:00+03:00',
  provisional: [
    { date: '2026-11-12', group: 'СР1', count: 4 },
    { date: '2026-11-12', group: 'СР3', count: 2 },
    { date: '2026-11-11', group: 'СР2', count: 7 },
  ],
} as Snapshot;

const entered = (patch: Record<string, string> = {}) => ({ СР1: '4', СР2: '0', СР3: '2', СР5: '0', СР6: '0', СР9: '0', ...patch });

describe('provisionalToday', () => {
  it('берёт только сегодняшние числа по серверу, остальным группам 0', () => {
    expect(provisionalToday(snapshot)).toEqual({ СР1: 4, СР2: 0, СР3: 2, СР5: 0, СР6: 0, СР9: 0 });
  });
});

describe('provisionalChanges', () => {
  const current = provisionalToday(snapshot);

  it('отдаёт только изменённые группы числами', () => {
    expect(provisionalChanges(current, entered({ СР1: '9', СР9: '3' }))).toEqual({
      changes: [{ group: 'СР1', count: 9 }, { group: 'СР9', count: 3 }],
    });
  });

  it('без изменений список пуст', () => {
    expect(provisionalChanges(current, entered())).toEqual({ changes: [] });
  });

  it.each(['', ' ', '-1', '2.5', 'abc', '10001', '1e2'])('значение %j отклоняется с названием группы', (bad) => {
    const result = provisionalChanges(current, entered({ СР5: bad }));
    expect(result).toMatchObject({ error: expect.stringContaining('СР5') });
  });

  it('пробелы вокруг числа не мешают', () => {
    expect(provisionalChanges(current, entered({ СР1: ' 5 ' }))).toEqual({ changes: [{ group: 'СР1', count: 5 }] });
  });
});

describe('paymentLogLines: журнал внесений за день', () => {
  const e = (id: number, at: string, group: PaymentLogEntry['group'], delta: number, source: string): PaymentLogEntry =>
    ({ id, at, date: at.slice(0, 10), group, delta, source });
  const log = [
    e(1, '2026-12-09T17:40:00+03:00', 'СР1', 3, 'admin'),
    e(2, '2026-12-10T09:05:12+03:00', 'СР2', 1, 'rg'),
    e(3, '2026-12-10T11:30:00+03:00', 'СР2', -1, 'rg'),
    e(4, '2026-12-10T12:00:59+03:00', 'СР5', 4, 'admin'),
    e(5, '2026-12-10T12:10:00+03:00', 'СР9', 2, 'import'),
  ];

  it('только этот день, новые сверху: время, группа, изменение и кто внёс', () => {
    expect(paymentLogLines(log, '2026-12-10')).toEqual([
      '12:10 · СР9 · +2 · другое',
      '12:00 · СР5 · +4 · координатор',
      '11:30 · СР2 · −1 · РГ',
      '09:05 · СР2 · +1 · РГ',
    ]);
  });

  it('за день ничего — пустой список', () => {
    expect(paymentLogLines(log, '2026-12-11')).toEqual([]);
  });
});
