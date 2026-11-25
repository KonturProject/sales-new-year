# Выпуск

Сайт: GitHub Pages, собирается Actions при пуше в `main`. Адрес сервера — переменная репозитория `BACKEND_URL` (пока пуста).

1. `npm test && npm run build && npm run audit:publish -- <xlsx для сверки фамилий> && npm run guard`.
2. «Да» владельца, затем `git push`.
3. Проверка живого сайта. Откат: `git revert` и пуш.

Пробная площадь: `…/sales-new-year/trial/?stats=1`.
