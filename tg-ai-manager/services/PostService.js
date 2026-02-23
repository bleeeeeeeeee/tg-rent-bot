const { CHANNEL_ID } = require('../config');

class PostService {
    constructor(bot) { this.bot = bot; }

    async publish(chatId, messageId) {
        return this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
    }

    schedule(chatId, messageId, minutes) {
        setTimeout(async () => {
            try {
                await this.publish(chatId, messageId);
            } catch (e) {
                console.error(e);
            }
        }, minutes * 60 * 1000);
    }
}

module.exports = PostService;