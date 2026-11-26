import { serverToday, type Snapshot } from '@/data/api';
import { walletChanges, type GroupChange } from './configPreview';
import { correctionViews, type CorrectionView } from './results';

/** Что изменится при переходе от снимка `before` к `after`: группы сегодня и устаревшие правки. */
export interface Effects {
  /** группы на сегодня (по серверу), у которых изменился процент плана, монеты, снежинки или ключики */
  now: GroupChange[];
  /** правки, у которых значение «из файла» после перехода не то, что админ видел (`base`) */
  stale: CorrectionView[];
}

export function effectsOf(before: Snapshot, after: Snapshot): Effects {
  return { now: walletChanges(before, after, serverToday(before)), stale: correctionViews(after).filter((v) => v.stale) };
}
