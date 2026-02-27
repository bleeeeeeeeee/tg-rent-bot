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
            const mt = require('./MediaType').detect(msg);
            summary = { main: `<${mt}>`, description: `<${mt}>` };
        } else {
            try {
                summary = await SummaryService.summarize(text);
                if (!summary) {
                    console.warn('no summary generated for publish text', text.slice(0,100));
                }
            } catch (e) {
                console.error('SummaryService failed', e);
            }
        }
        if (!summary) summary = {};
        // try to preserve the original post date if available
        const sentDate = msg.date || null;
        const groupId = msg.media_group_id || null; // only media albums
        const replyTo = msg.reply_to_message && msg.reply_to_message.message_id ? msg.reply_to_message.message_id : null;
        await HistoryRepository.addPublished(userId || '', chatId, msg.message_id, summary, sentDate, groupId, replyTo);
        return msg;
    }
}

module.exports = PostService;
