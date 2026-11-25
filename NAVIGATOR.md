# Карта проекта

| Тема | Где |
|---|---|
| Календарь, штат, нормы, план | `src/engine/{calendar,staff,evaluate,config}.ts` |
| Каталог, цены, валюты | `src/engine/{catalog,coins}.ts` |
| Ёлка, домики, недели, Гринч, финал | `src/engine/{tree,house,weeks,grinch,finale}.ts` |
| Рейтинги людей | `src/engine/ranking.ts` |
| Разбор выгрузок | `src/import` |
| Пробная площадь (автопоказ, `?stats=1`) | `public/trial` |
| Резка листов графики | `tools/slice.py` |
| Проверка перед коммитом и публикацией | `tools/audit-publish.mjs`, `tools/deploy-guard.mjs` |

Тесты движка, перенесённые из ноябрьской игры, идут на ноябрьском календаре: `novemberConfig` в `src/engine/testkit.ts`.
