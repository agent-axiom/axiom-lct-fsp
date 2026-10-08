# Разработка и локальный запуск

Команды выполняются из корня репозитория. Проверенный стек: Node.js 24.19.0 и npm из этого дистрибутива. Нижняя граница в `package.json` — Node.js 22.13.0; CI использует закреплённую версию 24.19.0.

## Установка

```sh
git clone https://github.com/agent-axiom/axiom-lct-fsp.git
cd axiom-lct-fsp
npm run install:ci
```

Репозиторий приватный: для клонирования нужен уже предоставленный доступ GitHub. Установщик использует `npm ci`, lockfile, dev- и optional-зависимости. Нужен доступ к npm registry; реальные аккаунты, ключи Cloudflare и email-провайдер для локального демо не требуются.

## Демонстрация

```sh
npm run build
node scripts/migrate-local.mjs
node scripts/local-demo.mjs
```

Откройте http://localhost:8888. Прокси добавляет вымышленную локальную идентичность и слушает loopback. Не публикуйте его в интернет и не используйте реальные персональные данные. Worker работает на локальном порту 8787.

Данные находятся в `.wrangler/state`, служебные настройки — в `.sites-runtime`. Для чистой проверки используйте новый checkout; не удаляйте чужое или используемое состояние. `migrate-local.mjs` применяет SQL-миграции по порядку и сохраняет список выполненных миграций.

## Проверки

Полная последовательность и различия software/HTTP/browser-проверок: [testing.md](testing.md). Быстрый набор:

```sh
npm test
npm run typecheck
npm run lint
npm run build
node scripts/migrate-local.mjs
node scripts/verify-clean-launch.mjs
```

Последний скрипт сам запускает и завершает локальный HTTP-сервер. Перед ним освободите порт 8787.

## Docker

```sh
docker compose up --build
```

Публикуется только `127.0.0.1:8888`, состояние хранится в volume `demo-data`. Docker-путь включён в исходники, но отдельного подтверждённого Docker-прогона пока нет.

## Браузерный smoke-скрипт

После локального запуска можно установить Chromium для Playwright и выполнить:

```sh
npx playwright install chromium
node tests/browser.mjs
```

По умолчанию скрипт обращается к `http://127.0.0.1:8787`. `CHROMIUM_PATH` задаёт путь браузера. Скрипт передаёт синтетические identity-заголовки: не направляйте его на публичный сервер через `FSP_TEST_URL`. Это краткий smoke, не полная программа проверки доступности или двух настоящих аккаунтов.

## Конфигурация и публикация

Настройки перечислены в [`.env.example`](../.env.example). Реальные значения и секреты не должны попадать в Git. `FSP_REAL_ACCOUNTS_ENABLED=false` и `FSP_EMAIL_MODE=off` сохраняют закрытый реальный режим.

В опубликованном приложении доверенную идентичность передаёт Sites. Другому хостингу нужен проверенный слой авторизации. Локальный прокси и произвольные forwarded-заголовки для этого не подходят. Подключение почты: [email-readiness.md](email-readiness.md).

Версии зависимостей фиксируются `package-lock.json`. Происхождение исходного экспорта: [source-export.md](source-export.md).
