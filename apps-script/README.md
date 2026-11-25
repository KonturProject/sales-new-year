# Сервер площади

Один файл `Code.gs` и манифест `appsscript.json`. Хранит факты в Google Таблице, правила считает страница.

## Развёртывание (один раз, около 20 минут)

1. Создайте пустую Google Таблицу. Идентификатор — часть адреса между `/d/` и `/edit`.
2. Расширения → Apps Script. Вставьте `Code.gs`; в настройках проекта включите показ манифеста и вставьте `appsscript.json`.
3. Настройки проекта → Свойства скрипта: `SPREADSHEET_ID` и `INITIAL_PIN` (4–12 цифр, придумайте свой).
4. Запустите `setupSpreadsheet`, затем `initAdminPin`. Разрешите доступ. `INITIAL_PIN` сотрётся сам, останется хеш.
5. Развернуть → Новое развёртывание → Веб-приложение: выполнять от своего имени, доступ у всех.
6. Адрес `…/exec` — в переменную репозитория `BACKEND_URL`. PIN никому не присылайте.

Правки `Code.gs` действуют только после «Управлять развёртываниями → карандаш → Новая версия». «Новое развёртывание» меняет адрес: не делать.

## Действия

| Кто | Действия |
|---|---|
| без PIN | `GET ?k=<ключ экрана>&since=<версия>` |
| РГ | `groupLogin`, `addPayment`, `buy` |
| админ | `login`, `changePin`, `setGroupPins`, `setScreenKey`, `setProvisional`, `importPayments`, `importFunnel`, `setStaff`, `setAbsence`, `removeAbsence`, `setConfig`, `removeConfigChange`, `setNonWorking`, `addCorrections`, `removeCorrection`, `getPrivate`, `grant`, `cancelPurchase`, `setGrinch`, `grinchCommand`, `screenCommand`, `setFinale`, `clearFinale` |

Ключ экрана создаётся при первом верном входе и лежит в свойстве `SCREEN_KEY`. Без него снимок не отдаётся: в нём ФИО.

Тесты гоняют этот же файл на имитации Google: `npx vitest run apps-script`.
