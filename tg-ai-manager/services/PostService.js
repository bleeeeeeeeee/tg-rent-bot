const { CHANNEL_ID } = require('../config');

class PostService {
    constructor(bot) { this.bot = bot; }

    async publish(chatId, messageId) {
        // copyMessage returns the newly created message in the channel
        const msg = await this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
        return msg;
    }
}

module.exports = PostService;