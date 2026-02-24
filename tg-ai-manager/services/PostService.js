const { CHANNEL_ID } = require('../config');
const HistoryRepository = require('./HistoryRepository');
const SummaryService = require('./SummaryService');

class PostService {
    constructor(bot) { this.bot = bot; }

    // userId is optional; scheduler can pass an empty string
    async publish(userId, chatId, messageId) {
        const msg = await this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
        const text = (msg.text || '') + (msg.caption ? '\n' + msg.caption : '');
        let summary = null;
        if (!text.trim()) {
            // media-only or link-only post – keep a basic marker
            summary = { main: '<медиа>', description: '<медиа>' };
        } else {
            try {
                summary = await SummaryService.summarize(text);
            } catch (e) {
                console.error('SummaryService failed', e);
            }
        }
        if (!summary) summary = {};
        // try to preserve the original post date if available
        const sentDate = msg.date || null;
        await HistoryRepository.addPublished(userId || '', chatId, msg.message_id, summary, sentDate);
        return msg;
    }
}

module.exports = PostService;
