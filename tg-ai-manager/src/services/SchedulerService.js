const { ADMIN_ID, OWNER_TELEGRAM_ID } = require('../config');
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
    if (this._timer) return;
    this._running = false;
    this._timer = setInterval(async () => {
      if (this._running) return;
      this._running = true;
      try {
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
      } finally {
        this._running = false;
      }
    }, 30000);
    if (this._timer.unref) this._timer.unref();
  }

  async notifyAdmin(channelMessage) {
    const notifyId = OWNER_TELEGRAM_ID || ADMIN_ID;
    await ChatCleanupService.flushBotMessages(this.bot, notifyId);

    const url = buildPostUrl(channelMessage.message_id);
    const opts = url
      ? { reply_markup: { inline_keyboard: [[{ text: 'Перейти в канал', url }]] } }
      : {};
    const msg = await this.bot.sendMessage(notifyId, 'Запланированный пост опубликован ✅', opts);
    ChatCleanupService.trackBotMessage(notifyId, msg.message_id);

    const menuMsg = await this.bot.sendMessage(notifyId, 'Выберите действие:', await MenuService.getMainMenu());
    ChatCleanupService.trackBotMessage(notifyId, menuMsg.message_id);
  }

  async notifyAdminError(message) {
    const notifyId = OWNER_TELEGRAM_ID || ADMIN_ID;
    await ChatCleanupService.flushBotMessages(this.bot, notifyId);
    const msg = await this.bot.sendMessage(
      notifyId,
      `❌ Не удалось опубликовать запланированный пост: ${message}`
    );
    ChatCleanupService.trackBotMessage(notifyId, msg.message_id);
  }
}

module.exports = SchedulerService;
