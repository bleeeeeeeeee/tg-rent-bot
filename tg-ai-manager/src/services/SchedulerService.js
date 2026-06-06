const { ADMIN_ID } = require('../config');
const MenuService = require('./MenuService');
const ChatCleanupService = require('./ChatCleanupService');
const PostService = require('./PostService');
const { buildPostUrl } = require('../utils/channelUrl');

class SchedulerService {
  constructor(bot, postRepository, publishService) {
    this.bot = bot;
    this.postRepository = postRepository;
    this.publishService = publishService;
  }

  start() {
    setInterval(async () => {
      const posts = await this.postRepository.getDueScheduled();

      for (const post of posts) {
        if (new Date(post.publishAt) <= new Date()) {
          try {
            const result = await this.publishService.publish(
              post.userId,
              post.chatId,
              post.messageId
            );
            await ChatCleanupService.releasePinnedMessage(this.bot, post.userId, post.messageId);
            this.notifyAdmin(result).catch(console.error);
            await this.postRepository.markAsPublished(post.id);
          } catch (err) {
            console.error('[SchedulerService] publish failed:', err.message);
            const reason = PostService.formatPublishError(err);
            if (PostService.isSourceMissing(err)) {
              await ChatCleanupService.releasePinnedMessage(this.bot, post.userId, post.messageId);
            }
            await this.postRepository.markAsFailed(post.id, reason);
            this.notifyAdminError(reason).catch(console.error);
          }
        }
      }
    }, 30000);
  }

  async notifyAdmin(channelMessage) {
    await ChatCleanupService.flushBotMessages(this.bot, ADMIN_ID);

    const url = buildPostUrl(channelMessage.message_id);
    const opts = url
      ? { reply_markup: { inline_keyboard: [[{ text: 'Перейти в канал', url }]] } }
      : {};
    const msg = await this.bot.sendMessage(ADMIN_ID, 'Запланированный пост опубликован ✅', opts);
    ChatCleanupService.trackBotMessage(ADMIN_ID, msg.message_id);

    const menuMsg = await this.bot.sendMessage(ADMIN_ID, 'Выберите действие:', await MenuService.getMainMenu());
    ChatCleanupService.trackBotMessage(ADMIN_ID, menuMsg.message_id);
  }

  async notifyAdminError(message) {
    await ChatCleanupService.flushBotMessages(this.bot, ADMIN_ID);
    const msg = await this.bot.sendMessage(
      ADMIN_ID,
      `❌ Не удалось опубликовать запланированный пост: ${message}`
    );
    ChatCleanupService.trackBotMessage(ADMIN_ID, msg.message_id);
  }
}

module.exports = SchedulerService;
