const { ADMIN_ID, CHANNEL_ID } = require('../config');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');

class SchedulerService {
    constructor(bot, postRepository, publishService) {
        this.bot = bot;
        this.postRepository = postRepository;
        this.publishService = publishService;
    }

    async addAdminCleanup(msg) {
        // no-op, keep history
    }

    async flushAdminCleanup() {
        // disabled
    }

    start() {
        setInterval(async () => {
            const now = new Date();

            const posts = await this.postRepository.getScheduled();

            for (const post of posts) {
                if (new Date(post.publishAt) <= now) {
                    const result = await this.publishService.publish(post.userId, post.chatId, post.messageId);
                    this.notifyAdmin(result).catch(console.error);
                    await this.postRepository.markAsPublished(post.id);
                }
            }

        }, 30000);
    }

    async notifyAdmin(channelMessage) {
        // clear any previous admin notifications so chat stays tidy
        await this.flushAdminCleanup();
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
        const m1 = await this.bot.sendMessage(ADMIN_ID, 'Запланированный пост опубликован ✅', opts);
        this.addAdminCleanup(m1);
        const m2 = await this.bot.sendMessage(ADMIN_ID, 'Выберите действие:', MenuService.getMainMenu());
        this.addAdminCleanup(m2);
    }}

module.exports = SchedulerService;