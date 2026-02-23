const { ADMIN_ID, CHANNEL_ID } = require('../config');
const MenuService = require('./MenuService');

class SchedulerService {
    constructor(bot, postRepository, publishService) {
        this.bot = bot;
        this.postRepository = postRepository;
        this.publishService = publishService;
    }

    start() {
        setInterval(async () => {
            const now = new Date();

            const posts = await this.postRepository.getScheduled();

            for (const post of posts) {
                if (new Date(post.publishAt) <= now) {
                    const result = await this.publishService.publish(post.chatId, post.messageId);
                    // notify admin about executed scheduled publish
                    this.notifyAdmin(result).catch(console.error);
                    await this.postRepository.markAsPublished(post.id);
                }
            }

        }, 30000);
    }

    async notifyAdmin(channelMessage) {
        let url = null;
        try {
            const chat = await this.bot.getChat(CHANNEL_ID);
            if (chat.username) {
                url = `https://t.me/${chat.username}/${channelMessage.message_id}`;
            }
        } catch (e) {
            console.error('notifyAdmin getChat failed', e);
        }
        if (!url) {
            const raw = String(channelMessage.chat.id);
            const id = raw.startsWith('-100') ? raw.slice(4) : raw.replace('-', '');
            url = `https://t.me/c/${id}/${channelMessage.message_id}`;
        }
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Перейти в канал', url }]]
            }
        };
        await this.bot.sendMessage(ADMIN_ID, 'Запланированный пост опубликован ✅', opts);
        await this.bot.sendMessage(ADMIN_ID, 'Выберите действие:', MenuService.getMainMenu());
    }}

module.exports = SchedulerService;