#!/usr/bin/env node

/**
 * Утилита для отладки и просмотра состояния existing_posts.json
 * Запуск: node debug-posts.js
 */

const ExistingPosts = require('./src/services/ExistingPosts');

(async () => {
  try {
    console.log('\n📊 === СТАТИСТИКА ПОСТОВ ===\n');

    const posts = await ExistingPosts.getAll();
    const count = await ExistingPosts.count();

    console.log(`Всего постов: ${count}`);
    console.log(`\nПосты (по messageId):`);
    console.log('─'.repeat(80));

    posts.forEach(p => {
      const textPreview = p.text.substring(0, 50).replace(/\n/g, ' ');
      const mediaStr = p.media ? `${p.media.type} (x${p.media.count})` : 'нет медиа';
      const replyStr = p.replyTo ? ` → ответ на #${p.replyTo}` : '';
      console.log(`#${p.messageId.toString().padStart(4)} │ ${mediaStr.padEnd(20)} │ "${textPreview.substring(0, 40).padEnd(40)}..."${replyStr}`);
    });

    console.log('─'.repeat(80));
    console.log(`\nДата последнего поста: ${posts.length > 0 ? posts[posts.length - 1].addedAt : 'N/A'}`);
    console.log('\n✅ Проверка завершена\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();
