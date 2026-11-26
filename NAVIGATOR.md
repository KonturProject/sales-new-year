# Карта проекта

| Тема | Где |
|---|---|
| Календарь, штат, нормы, план | `src/engine/{calendar,staff,evaluate,config}.ts` |
| Каталог, цены, валюты | `src/engine/{catalog,coins}.ts` |
| Ёлка, домики, недели, Гринч, финал | `src/engine/{tree,house,weeks,grinch,finale}.ts` |
| Рейтинги людей | `src/engine/ranking.ts` |
| Разбор выгрузок (правило Академии — `payments.ts`) | `src/import` |
| Снимок, опрос, ключ экрана, факты, демо | `src/data/{api,store,facts,metrics}.ts`, `src/demo/demo.ts` |
| Страница РГ: платёжки, лавка, подарки, чердак, подвал | `src/rg/{main,model,spend}.ts` |
| Админка: вход и PIN сессии, ключ экрана при входе | `src/admin/{main,session,ctx}.ts` |
| Админка: «Сегодня» (задачи, прогноз ёлки) | `src/admin/today.ts` |
| Админка: итоги групп, ручные правки фактов | `src/admin/{results,resultsText,resultsView,resultsTab,resultsFlow,correctionSaver}.ts` |
| Админка: оплаты за сегодня и журнал внесений | `src/admin/payments.ts` |
| Админка: импорт воронки и оплат, что изменит загрузка | `src/admin/{importTab,importPlan,importPreview,effects}.ts` |
| Админка: сотрудники, JSON штата с отсутствиями | `src/admin/{staffTab,staffForm}.ts` |
| Админка: нормы, выходные, предпросмотр | `src/admin/{normsTab,configForm,configPreview,calendarForm,holidaysBlock}.ts` |
| Админка: покупки (отмена с причиной), выдача валюты | `src/admin/{purchasesTab,purchases}.ts` |
| Админка: Гринч (кнопки, «Сам по себе», тишина) | `src/admin/{grinchTab,grinch}.ts` |
| Админка: сцены на экранах, ссылка и смена ключа экрана | `src/admin/{screenTab,screen}.ts` |
| Админка: финал (отсечка, предпросмотр, провести, отменить) | `src/admin/{finaleTab,finale}.ts`, `src/data/finale.ts` |
| Админка: PIN групп | `src/admin/{pins,pinForm}.ts` |
| Сервер (Apps Script) и его тесты | `apps-script/Code.gs`, `apps-script/test` |
| Мок сервера на настоящем `Code.gs` | `tools/mock-backend.mjs` |
| Проверки в браузере на моке | `tools/check-rg.mjs`, `tools/check-admin.mjs` |
| Пробная площадь (автопоказ, `?stats=1`) | `public/trial` |
| Сборка графики из листов | `tools/pack.py` |
| Проверка перед коммитом и публикацией | `tools/audit-publish.mjs`, `tools/deploy-guard.mjs` |

Тесты движка, перенесённые из ноябрьской игры, идут на ноябрьском календаре: `novemberConfig` в `src/engine/testkit.ts`.
