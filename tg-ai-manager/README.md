# Telegram AI Manager Bot - Telegram Bot для публикации в канал

## Описание

Telegram бот для управления публикациями в канале Telegram. Позволяет создавать черновики, планировать публикации и отслеживать опубликованные посты.

## Основные возможности

- 📢 **Публикация** - опубликовать пост в канал сразу или позже
- 📝 **Черновики** - сохранять черновики для дальнейшей публикации
- ⏳ **Планирование** - запланировать публикацию на определённую дату и время
- 📊 **Отслеживание постов** - вся информация о постах сохраняется в JSON

## Структура проекта

```
tg-ai-manager/
├── config.js                 # Конфигурация
├── index.js                 # Точка входа
├── package.json
│
├── services/
│   ├── BotService.js        # Основной сервис бота
│   ├── PostService.js       # Публикация постов
│   ├── DraftService.js      # Черновики
│   ├── SchedulerService.js  # Планирование
│   ├── MenuService.js       # Меню
│   ├── StateManager.js      # Состояние
│   ├── ExistingPosts.js     # Управление постами
│   ├── PostRepository.js    # Публикации
│   └── MediaType.js         # Типы медиа
│
└── storage/
    ├── drafts.json
    ├── scheduled.json
    └── existing_posts.json
```

## Что такое пост

**Пост = одно сообщение** в Telegram канале.

Пост может содержать:
- Текст
- Одно или несколько медиа (фото, видео, аудио, документы и т.д.)
- Быть ответом на другой пост

**Важно**: Несколько фото в одном альбоме - это **один пост**.

## Формат сохранения постов

Все посты хранятся в `storage/existing_posts.json`:

```json
{
  "posts": [
    {
      "messageId": 1,
      "text": "Текст поста",
      "media": {
        "type": "фото",
        "count": 2
      },
      "replyTo": null,
      "addedAt": "2026-02-28T08:48:23.326Z"
    }
  ]
}
```

### Поля

- **messageId** - номер сообщения в канале
- **text** - текст сообщения
- **media** - информация о медиа (или null):
  - `type` - `фото`, `видео`, `аудио`, `голос`, `документ`, `стикер`
  - `count` - количество элементов
- **replyTo** - ID поста, на который это ответ (или null)
- **addedAt** - дата добавления

## Примеры

### Пост с фото (альбом)
```json
{
  "messageId": 1,
  "text": "Смотрите фото",
  "media": {"type": "фото", "count": 2},
  "replyTo": null,
  "addedAt": "2026-02-28T08:48:23.326Z"
}
```

### Ответ на пост
```json
{
  "messageId": 3,
  "text": "Согласен!",
  "media": null,
  "replyTo": 1,
  "addedAt": "2026-02-28T08:48:25.000Z"
}
```

## API ExistingPosts

```javascript
const ExistingPosts = require('./services/ExistingPosts');

// Добавить пост
await ExistingPosts.addPost(messageId, text, mediaInfo, replyToId);

// Получить все
const posts = await ExistingPosts.getAll();

// Получить один
const post = await ExistingPosts.getById(messageId);

// Проверить
const exists = await ExistingPosts.exists(messageId);

// Удалить
await ExistingPosts.removePost(messageId);
```

## Установка

```bash
npm install
```

Создайте `.env`:
```
BOT_TOKEN=your_token
ADMIN_ID=your_id
CHANNEL_ID=channel_id
```

## Запуск

```bash
npm start
```

## Команды

- `/start` - начать
- `/pinchannel` - закрепить ссылку

## Технологический стек

- Node.js
- node-telegram-bot-api
- JSON storage

## Лицензия

MIT

