const { CHANNEL_ID } = require('../config');

class PostService {
    constructor(bot) { this.bot = bot; }

    async publish(chatId, messageId) {
        return this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
    }
}

module.exports = PostService;