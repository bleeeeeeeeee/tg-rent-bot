const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID, CHANNEL_ID } = require('./config');
const ExistingPosts = require('./services/ExistingPosts');

/**
 * Скрипт для синхронизации всех существующих постов из канала
 * Пройдёт по всем постам в канале и добавит их в ExistingPosts
 */
async function syncExistingPosts() {
    console.log('🔄 Запускаю синхронизацию постов из канала...\n');
    console.log('⚠️  ВАЖНО: Этот скрипт имеет ограничения Telegram API.');
    console.log('💡 Рекомендация: используйте "npm start" для автоматической синхронизации.\n');

    const bot = new TelegramBot(BOT_TOKEN, { polling: false });

    let added = 0;
    let skipped = 0;
    let errors = 0;
    let MAX_ID = 1000000;
    let consecutiveMisses = 0;

    for (let messageId = 1; messageId <= MAX_ID; messageId++) {
        try {
            // Используем forwardMessage чтобы получить оригинальное сообщение без изменений
            const msg = await bot.forwardMessage(ADMIN_ID, CHANNEL_ID, messageId);

            // Получаем текст из сообщения
            let text = '';
            if (msg.text) {
                text = msg.text;
            } else if (msg.caption) {
                text = msg.caption;
            }

            // Определяем информацию о медиа
            let mediaInfo = null;
            if (msg.photo && msg.photo.length > 0) {
                mediaInfo = { type: 'фото', count: msg.photo.length };
            } else if (msg.video) {
                mediaInfo = { type: 'видео', count: 1 };
            } else if (msg.audio) {
                mediaInfo = { type: 'аудио', count: 1 };
            } else if (msg.voice) {
                mediaInfo = { type: 'голос', count: 1 };
            } else if (msg.document) {
                mediaInfo = { type: 'документ', count: 1 };
            } else if (msg.sticker) {
                mediaInfo = { type: 'стикер', count: 1 };
            } else if (msg.animation) {
                mediaInfo = { type: 'анимация', count: 1 };
            } else if (msg.video_note) {
                mediaInfo = { type: 'видео_сообщение', count: 1 };
            }

            // Проверяем, это ответ на другой пост или нет
            const replyTo = msg.reply_to_message ? msg.reply_to_message.message_id : null;

            // Добавляем пост
            const existingPost = await ExistingPosts.getById(messageId);
            if (!existingPost) {
                await ExistingPosts.addPost(messageId, text, mediaInfo, replyTo);
                const mediaStr = mediaInfo ? `${mediaInfo.type}(x${mediaInfo.count})` : 'текст';
                const textPreview = text ? text.substring(0, 30).replace(/\n/g, ' ') : '[без текста]';
                const replyStr = replyTo ? ` → ответ на #${replyTo}` : '';
                console.log(`✅ #${messageId}: ${mediaStr} | "${textPreview}..."${replyStr}`);
                added++;
            } else {
                skipped++;
            }

            consecutiveMisses = 0;

        } catch (error) {
            errors++;
            
            if (error.statusCode === 400 || error.message.includes('not found') || error.message.includes("can't be copied")) {
                consecutiveMisses++;
            } else if (error.statusCode === 429) {
                console.log('⏳ Rate limit, жду 3 секунды...');
                await new Promise(r => setTimeout(r, 3000));
                consecutiveMisses = 0;
                messageId--;
                continue;
            } else if (error.statusCode === 403) {
                console.error(`❌ Ошибка доступа: бот не имеет права читать канал`);
                process.exit(1);
            }

            if (consecutiveMisses > 150) {
                console.log(`\n⏹️ Остановились, похоже достигли конца канала\n`);
                break;
            }
        }

        if (messageId % 50 === 0) {
            const status = `Проверено: ${messageId} | Добавлено: ${added} | Пропущено: ${skipped}`;
            console.log(`📍 ${status}`);
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ СИНХРОНИЗАЦИЯ ЗАВЕРШЕНА!');
    console.log('='.repeat(70));
    console.log(`📊 Добавлено постов:     ${added}`);
    console.log(`⏭️  Пропущено (уже есть):  ${skipped}`);
    console.log(`⚠️  Ошибок при обработке: ${errors}`);
    console.log(`📈 Всего в базе:         ${added + skipped}`);
    console.log('='.repeat(70) + '\n');

    process.exit(0);
}

syncExistingPosts().catch(error => {
    console.error('💥 Ошибка:', error.message);
    process.exit(1);
});
