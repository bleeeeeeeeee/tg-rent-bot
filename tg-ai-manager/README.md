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
| `CHANNEL_ID` | Канал, которым управляет бот | Публичный: `@username_канала` (с `@`).<br>Приватный: числовой id `-1001234567890` — узнать через [@getmyid_bot](https://t.me/getmyid_bot), переслав сообщение из канала, или из URL в веб-версии Telegram |

**Канал и бот:** добавьте бота в канал как **администратора** (достаточно права публиковать сообщения и читать историю, если доступно).

### Необязательные переменные

| Переменная | Зачем | Как получить |
|------------|-------|--------------|
| `TIMEZONE` | Часовой пояс для истории и расписания | IANA-имя, по умолчанию `Europe/Moscow`. Примеры: `UTC`, `Europe/Kiev`, `Asia/Almaty`. Тот же формат можно сменить в боте: Настройки → Основные. |
| `OPENAI_API_KEY` | Стартовый ключ OpenAI | [platform.openai.com](https://platform.openai.com/api-keys). Можно не указывать — ключи всех ИИ-сервисов можно добавить в боте: Настройки → ИИ для постов. |

### Переменные для импорта постов (GramJS)

Нужны **только** если запускаете `npm run import:channel` или `npm run reconcile`. Для работы самого бота **не обязательны**.

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
| `npm run reconcile` | Сверка архива с каналом. Нужен `TG_SESSION`. |
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

## Архив канала

- **Автоматически:** при работающем `npm start` новые посты и правки в канале сохраняются в архив.
- **Старые посты:** `npm run import:channel` (GramJS + `.env`) или `npm run import:export` (файл экспорта Desktop).
