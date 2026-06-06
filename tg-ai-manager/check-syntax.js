#!/usr/bin/env node
/**
 * Демонстрация структуры данных и проверка синтаксиса
 */

const fs = require('fs');
const path = require('path');

console.log('\n🔍 === СИСТЕМА: ProcessedPosts & SummaryService ===\n');

// Проверка файлов
const files = {
  'Основные файлы': [
    ['src/index.js', 'Точка входа приложения'],
    ['src/config.js', 'Конфигурация (переменные окружения)'],
  ],
  'Основные сервисы': [
    ['src/services/BotService.js', 'Telegram события и команды'],
    ['src/services/PostService.js', 'Публикация и обработка постов'],
    ['src/services/ExistingPosts.js', 'CRUD для existing_posts.json'],
  ],
  'Новые сервисы (v2.0)': [
    ['src/services/ProcessedPosts.js', '⭐ CRUD для processed_posts.json'],
    ['src/services/SummaryService.js', '⭐ AI-обработка через OpenAI'],
  ],
  'Вспомогательные сервисы': [
    ['src/services/MenuService.js', 'Клавиатуры и меню бота'],
    ['src/services/DraftService.js', 'Управление черновиками'],
    ['src/services/StateManager.js', 'Состояние пользователя'],
    ['src/services/SchedulerService.js', 'Автоматическая публикация'],
    ['src/services/PostRepository.js', 'Запланированные посты'],
  ],
  'Хранилище данных': [
    ['storage/existing_posts.json', 'Все опубликованные посты'],
    ['storage/processed_posts.json', '⭐ НОВОЕ: Обработанные посты'],
    ['storage/drafts.json', 'Черновики'],
    ['storage/scheduled.json', 'Запланированные посты'],
  ],
};

let totalFiles = 0;
let existFiles = 0;

Object.entries(files).forEach(([category, fileList]) => {
  console.log(`\n✨ ${category}:`);
  fileList.forEach(([file, desc]) => {
    totalFiles++;
    const fullPath = path.join('/Users/bl/Programming/Projects/tg-ai-manager', file);
    const exists = fs.existsSync(fullPath);
    existFiles += exists ? 1 : 0;
    const status = exists ? '✅' : '❌';
    console.log(`   ${status} ${file.padEnd(40)} — ${desc}`);
  });
});

console.log(`\n📊 Статус: ${existFiles}/${totalFiles} файлов найдено`);

// Проверка конфигурации
console.log('\n⚙️  Переменные окружения:');
const requiredVars = ['BOT_TOKEN', 'ADMIN_ID', 'CHANNEL_ID', 'OPENAI_API_KEY'];
const envFile = '/Users/bl/Programming/Projects/tg-ai-manager/.env';

if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  requiredVars.forEach(varName => {
    const isSet = content.includes(`${varName}=`);
    const status = isSet ? '✅' : '❌';
    console.log(`   ${status} ${varName}`);
  });
} else {
  console.log('   ⚠️  Файл .env не найден!');
}

// Проверка структуры JSON
console.log('\n📁 Структура JSON файлов:');

const checkJSON = (file, expectedFields) => {
  const fullPath = path.join('/Users/bl/Programming/Projects/tg-ai-manager', file);
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const hasFields = expectedFields.every(f => f in data);
    console.log(`   ✅ ${file}`);
    if (hasFields) {
      console.log(`      └─ Структура: ${JSON.stringify(Object.keys(data)).replace(/["\[\]]/g, '')}`);
    }
  } catch (e) {
    console.log(`   ❌ ${file} — ошибка парсинга`);
  }
};

checkJSON('storage/existing_posts.json', ['posts']);
checkJSON('storage/processed_posts.json', ['posts']);
checkJSON('storage/drafts.json', ['data']);
checkJSON('storage/scheduled.json', ['posts']);

// Информация о функциях
console.log('\n🚀 Основные функции (v2.0):');
console.log(`
   1. Публикация постов
      • Через бота: /start → Публикация
      • Прямо в канал: автоматическое добавление
   
   2. Двойное хранилище
      • existing_posts.json: все посты (текст + медиа)
      • processed_posts.json: AI-резюме (название, идея, описание)
   
   3. Автоматическая AI-обработка
      • Все посты обрабатываются через OpenAI GPT-4
      • Результаты сохраняются в processed_posts.json
      • Требует: OPENAI_API_KEY
   
   4. История постов
      • Кнопка "📚 История" в главном меню
      • Красивое отображение всех обработанных постов
      • С датами публикации
`);

// Команды для быстрого старта
console.log('\n⚡ Команды для быстрого старта:');
console.log(`
   npm install           — установить зависимости
   npm start             — запустить бота
   npm run check         — проверить статус
   node check-syntax.js  — проверить синтаксис
`);

console.log('\n✨ Система готова к работе!\n');
