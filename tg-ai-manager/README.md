# tg-ai-manager

Telegram-бот для управления одним каналом: публикация, черновики, расписание, история постов, ИИ-анализ.

## Быстрый старт

```bash
cp .env.example .env
# заполните .env (см. раздел ниже)
npm install
npm start
```

Бот должен быть **администратором канала** — иначе новые посты не попадут в архив автоматически.

## Запуск ИИ (ollama на MacBook)

```bash
start-ai
```

---

## Файл `.env`

Файл лежит в **корне проекта**: `tg-ai-manager/.env`  
В git не попадает. Шаблон: [`.env.example`](.env.example).

Формат: одна переменная на строку, без кавычек (если значение без пробелов):

```env
BOT_TOKEN=123456:ABC-DEF...
ADMIN_ID=987654321
CHANNEL_ID=@my_channel
```

После изменения `.env` перезапустите бота (`npm start`) или скрипт в терминале.

### Обязательные переменные

| Переменная | Зачем | Как получить |
|------------|-------|--------------|
| `BOT_TOKEN` | Токен бота для API Telegram | 1. Напишите [@BotFather](https://t.me/BotFather)<br>2. `/newbot` или выберите существующего<br>3. Скопируйте токен вида `123456789:AAH...` |
| `ADMIN_ID` | Единственный пользователь, которому бот отвечает | 1. Напишите [@userinfobot](https://t.me/userinfobot) или [@getmyid_bot](https://t.me/getmyid_bot)<br>2. Скопируйте **Id** (число, например `987654321`) |
| `OWNER_TELEGRAM_ID` | То же, что `ADMIN_ID` (рекомендуется в облаке) | Владелец канала; получает уведомления о публикации |
| `CHANNEL_ID` | Канал, которым управляет бот | Публичный: `@username_канала` (с `@`).<br>Приватный: числовой id `-1001234567890` — узнать через [@getmyid_bot](https://t.me/getmyid_bot), переслав сообщение из канала, или из URL в веб-версии Telegram |

**Канал и бот:** добавьте бота в канал как **администратора** (достаточно права публиковать сообщения и читать историю, если доступно).

### Необязательные переменные

| Переменная | Зачем | Как получить |
|------------|-------|--------------|
| `TIMEZONE` | Часовой пояс для истории и расписания | IANA-имя, по умолчанию `Europe/Moscow`. Примеры: `UTC`, `Europe/Kiev`, `Asia/Almaty`. Тот же формат можно сменить в боте: Настройки → Основные. |
| `OPENAI_API_KEY` | Стартовый ключ OpenAI | [platform.openai.com](https://platform.openai.com/api-keys). Можно не указывать — ключи всех ИИ-сервисов можно добавить в боте: Настройки → ИИ для постов. |

### Облако (Supabase)

| Переменная | Значение |
|------------|----------|
| `STORAGE_BACKEND` | `file` (по умолчанию), `supabase` или `dual` |
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_SERVICE_KEY` | service_role key (только на сервере) |
| `SYNC_ENABLED` | `true` для dual-sync с локальными файлами |
| `INSTANCE_ID` | Уникальный id инстанса (для heartbeat) |

Подробнее — раздел [Облачный запуск](#облачный-запуск-247) ниже.

### Переменные для импорта постов (GramJS)

Нужны для **истории постов** (импорт из канала, кнопка «Сверить с каналом») и CLI `import:channel` / `reconcile`. На облаке (Northflank) добавьте их в **Runtime Variables**, иначе архив будет пустым для старых постов — бот видит только новые публикации через `channel_post`.

| Переменная | Зачем | Как получить |
|------------|-------|--------------|
| `TG_API_ID` | ID приложения Telegram | 1. Войдите на [my.telegram.org](https://my.telegram.org)<br>2. «API development tools»<br>3. Создайте приложение<br>4. Скопируйте **App api_id** (число) |
| `TG_API_HASH` | Hash приложения | Там же — **App api_hash** (строка) |
| `TG_SESSION` | Сессия вашего аккаунта Telegram | См. пошагово ниже — **без неё `import:channel` не запустится** |

#### Как получить `TG_SESSION` (пошагово)

1. Добавьте в `.env` уже полученные `TG_API_ID` и `TG_API_HASH`.
2. В терминале из папки проекта:

```bash
npm run gram:login
```

3. Введите по запросу:
   - номер телефона в формате `+79991234567`;
   - код из Telegram;
   - пароль 2FA — если включён (иначе Enter).
4. Скрипт **сам запишет** `TG_SESSION=...` в `.env` (строка «✅ Вход выполнен»).
5. Проверка:

```bash
npm run import:channel
```

> **Важно:** `TG_SESSION` — доступ к **вашему** аккаунту Telegram, не к боту. Не коммитьте `.env`.

---

## GramJS: что делают команды

Скрипты работают от **вашего личного** аккаунта (GramJS), не от бота (`BOT_TOKEN`).

| Команда | Что делает |
|---------|------------|
| `npm run gram:login` | Вход: телефон + код → сессия → запись `TG_SESSION` в `.env`. |
| `npm run import:channel` | Загружает посты канала в `storage/existing-posts.json`. Нужны `TG_API_ID`, `TG_API_HASH`, `TG_SESSION`. |
| `npm run import:export` | Импорт из JSON Telegram Desktop. GramJS не нужен. |
| `npm run reconcile` | Полная синхронизация: загрузка постов из канала + пометка удалённых. Нужен `TG_SESSION`. |
| `npm run enrich` | ИИ по всем постам архива. Нужен провайдер в боте / `secrets.json`. |

### «TG_SESSION is required» после gram:login

В `.env` **нет** непустой строки `TG_SESSION=...`. Раньше скрипт только **печатал** сессию в терминал — её нужно было вручную вставить в файл.

**Решение:**

1. Снова: `npm run gram:login` → дождитесь «✅ Вход выполнен».
2. Проверка (секрет не показывается):

```bash
node -e "require('dotenv').config(); console.log(process.env.TG_SESSION ? 'TG_SESSION: ok' : 'TG_SESSION: missing')"
```

3. Запускайте команды из **корня проекта**, где лежит `.env`.

**Частые ошибки:** не скопировали строку из терминала; кавычки вокруг значения; перенос строки посередине; опечатка `TG_SESSIONS`; пустое `TG_SESSION=`; `gram:login` упал до успеха.

---

## Бот (в Telegram)

| Команда | Действие |
|---------|----------|
| `/start` | Главное меню |
| `/settings` | Настройки |
| `/stats` | Статистика архива |
| `/pinchannel` | Закрепить ссылку на канал |

**Публикация → Темы для постов** — ИИ предлагает идеи:
- **Новые (уникальные)** — темы, которых ещё не было в канале
- **В стиле канала** — похожие на прошлые публикации
- **Похожие на пост…** — выбрать конкретный пост как ориентир

Выбранную тему можно сразу передать в мастер «Написать с ИИ» или сохранить в черновики.

Подробнее — **Настройки → Инструкция** в боте.

Ключи нейросетей (OpenRouter, Gemini, Groq и др.) задаются **в боте**, не обязательно в `.env`.

---

## Скрипты (только в терминале проекта)

Не вводятся в чат с ботом. Запуск из корня репозитория.

### Импорт и обслуживание архива

```bash
# загрузить посты из канала (нужны TG_API_ID, TG_API_HASH, TG_SESSION)
npm run import:channel

# импорт из JSON-экспорта Telegram Desktop (GramJS не нужен)
npm run import:export -- path/to/result.json

# сверка архива с каналом
npm run reconcile

# прогнать ИИ по всем постам
npm run enrich
```

### Полезные флаги

```bash
npm run import:channel -- --limit 500 --enrich
npm run import:channel -- --dry-run

npm run import:export -- export/result.json --enrich

npm run reconcile -- --dry-run
npm run enrich -- --force
```

---

## Данные

Каталог `storage/` (создаётся автоматически, в git не попадает):

| Файл | Содержимое |
|------|------------|
| `existing-posts.json` | Архив постов канала |
| `scheduled-posts.json` | Очередь публикаций |
| `drafts.json` | Черновики |
| `settings.json` | Настройки бота |
| `secrets.json` | Ключи API (из бота) |

---

## Облачный запуск (24/7)

Бот может работать круглосуточно на VPS с общей базой **Supabase** (бесплатный tier). Локальный ПК и облако используют **одни данные** через Postgres — это не два бота с одним `BOT_TOKEN` (одновременный polling с одним токеном невозможен).

### Стек

| Компонент | Сервис |
|-----------|--------|
| БД + Realtime | [Supabase Free](https://supabase.com/pricing) |
| VPS 24/7 | [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) (ARM VM) или Docker-хост |

### Supabase

1. Создайте проект на [supabase.com](https://supabase.com).
2. SQL Editor → выполните [`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql).
3. Settings → API: скопируйте **Project URL** и **service_role** key (не anon key).

### Переменные `.env` на VPS

```env
STORAGE_BACKEND=supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
OWNER_TELEGRAM_ID=123456789
BOT_TOKEN=...
CHANNEL_ID=@channel
INSTANCE_ID=vps-1
```

Локально с синхронизацией:

```env
STORAGE_BACKEND=dual
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
SYNC_ENABLED=true
```

### Деплой на Oracle Free (Ubuntu)

```bash
sudo apt update && sudo apt install -y git nodejs npm
sudo git clone <repo> /opt/tg-ai-manager
cd /opt/tg-ai-manager
cp .env.example .env   # заполните
npm install
sudo cp deploy/tg-ai-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tg-ai-manager
sudo journalctl -u tg-ai-manager -f
```

### Docker

```bash
cp .env.example .env
docker compose up -d --build
```

Volume `storage/` — для локального backup; при `STORAGE_BACKEND=supabase` основные данные в Postgres.

### Northflank / облачный PaaS

1. Build context: `tg-ai-manager`, Dockerfile: `tg-ai-manager/Dockerfile`
2. **Runtime Variables** (не Build — `.env` в образ не попадает):

```env
BOT_TOKEN=...
OWNER_TELEGRAM_ID=...
CHANNEL_ID=@channel
STORAGE_BACKEND=supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
TIMEZONE=Europe/Moscow
INSTANCE_ID=northflank-1
HEALTH_PORT=8080
BOT_MODE=webhook
WEBHOOK_URL=https://ВАШ-ДОМЕН.northflank.app/telegram/webhook
WEBHOOK_SECRET=случайная-длинная-строка
```

3. **Webhook:** Telegram шлёт апдейты на `POST /telegram/webhook` (тот же порт, что health check). Публичный URL сервиса Northflank → в `WEBHOOK_URL`. Локально `npm start` **без** `WEBHOOK_URL` — polling.
4. Health check: `GET /health` на порту 8080 (отключить: `HEALTH_PORT=0`, но тогда webhook не работает)
5. Node 22 в Docker (нативный WebSocket для Supabase)
6. **Один** инстанс на один `BOT_TOKEN` — не запускайте `npm start` на Mac одновременно с облаком

**Ollama в продакшене (без ngrok и Mac):**

Mac + Northflank + ngrok — ненадёжно (нужен постоянно включённый Mac, туннель, в РБ ngrok часто без VPN). Правильно: **Ollama на том же сервере, что и бот**.

**Вариант A — один VPS + Docker (рекомендуется для Ollama):**

```bash
docker compose up -d --build
docker compose exec ollama ollama pull llama3.2
```

В `.env`: `BOT_MODE=webhook`, `WEBHOOK_URL=…`, Supabase. Compose уже задаёт `OLLAMA_BASE_URL=http://ollama:11434` — бот ходит в Ollama по внутренней сети Docker.

**Вариант B — Northflank, два сервиса в одном проекте:**

1. Сервис `ollama` — образ `ollama/ollama`, порт 11434, persistent volume.
2. Сервис `manager` (бот) — переменные как сейчас **плюс**:
   ```env
   OLLAMA_BASE_URL=http://ollama:11434
   OLLAMA_AUTO_ACTIVATE=true
   OLLAMA_MODEL=llama3.2
   ```
3. Один раз в shell сервиса ollama: `ollama pull llama3.2`

Имя хоста `ollama` — internal DNS Northflank между сервисами проекта (не публичный URL).

**Вариант C — без Ollama в облаке:** Groq или OpenRouter — уже в боте, работают с Northflank без VPN.

**Ollama на Mac + бот в облаке:** только через туннель (ngrok/Cloudflare). Для 24/7 не используйте.

**Резервное копирование (cron):**

```bash
# каждый день в 03:00
0 3 * * * cd /path/to/tg-ai-manager && npm run backup:export >> storage/backups/cron.log 2>&1
```

Файлы сохраняются в `storage/backups/`.

### Настройки в боте

**Настройки:** AI, внешний вид, часовой пояс, язык (ru/en).

**Админ-панель (`/admin`):** доступ (мастер-пароль, коды, сеансы, журнал, права гостя), облако (push/pull с предупреждением о конфликте), система, обслуживание и backup.

Гости видят ограниченное меню; редактирование черновиков включается в админке.

---

## Архив канала

- **Автоматически:** при работающем `npm start` новые посты и правки в канале сохраняются в архив.
- **Старые посты:** `npm run import:channel` (GramJS + `.env`) или `npm run import:export` (файл экспорта Desktop).
