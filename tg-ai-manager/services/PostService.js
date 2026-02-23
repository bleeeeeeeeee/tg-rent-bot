const { CHANNEL_ID } = require('../config');

class PostService {
    constructor(bot) { this.bot = bot; }

    async publish(chatId, messageId) {
        const msg = await this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
        return msg;
    }
}

module.exports = PostService;