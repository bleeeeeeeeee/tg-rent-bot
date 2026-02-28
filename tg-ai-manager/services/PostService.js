const { CHANNEL_ID } = require('../config');
const ExistingPosts = require('./ExistingPosts');
const { detect: detectMediaType } = require('./MediaType');

class PostService {
    constructor(bot) { this.bot = bot; }

    // userId is optional; scheduler can pass an empty string
    async publish(userId, chatId, messageId) {
        const msg = await this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
        const text = (msg.text || '') + (msg.caption ? '\n' + msg.caption : '');

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
        }

        // Проверяем, это ответ на другой пост или нет
        const replyTo = msg.reply_to_message ? msg.reply_to_message.message_id : null;

        // Добавляем пост в ExistingPosts
        await ExistingPosts.addPost(msg.message_id, text, mediaInfo, replyTo);

        console.log(`Пост #${msg.message_id} опубликован и добавлен в ExistingPosts`);

        return msg;
    }
}

module.exports = PostService;
