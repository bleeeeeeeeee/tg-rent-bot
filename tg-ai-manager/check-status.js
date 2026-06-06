const ExistingPosts = require('./src/services/ExistingPosts');
const ProcessedPosts = require('./src/services/ProcessedPosts');

(async () => {
  try {
    console.log('\n📊 === ПРОВЕРКА СТАТУСА ===\n');
    
    const existing = await ExistingPosts.getAll();
    const processed = await ProcessedPosts.getAll();
    
    console.log(`✅ Существующих постов: ${existing.length}`);
    if (existing.length > 0) {
      console.log('\nПримеры:');
      existing.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i+1}. #${p.messageId}: "${p.text.substring(0, 50)}..."`);
        console.log(`     Опубликовано: ${new Date(p.publishedAt).toLocaleString('ru-RU')}`);
      });
      if (existing.length > 3) console.log(`  ... и ещё ${existing.length - 3} постов`);
    }
    
    console.log(`\n✅ Обработанных постов: ${processed.length}`);
    if (processed.length > 0) {
      console.log('\nПримеры:');
      processed.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i+1}. "${p.title}"`);
        console.log(`     ${p.mainIdea}`);
      });
      if (processed.length > 3) console.log(`  ... и ещё ${processed.length - 3} постов`);
    }
    
    console.log('\n🔄 Статус: готов к работе\n');
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    process.exit(1);
  }
})();
