const SettingsService = require('./SettingsService');

class ChatCleanupService {
  constructor() {
    this.stacks = new Map();
    this.replyKeyboardReady = new Set();
  }

  _stack(chatId) {
    const id = Number(chatId);
    if (!this.stacks.has(id)) {
      this.stacks.set(id, { botMessages: [], pinned: new Set() });
    }
    return this.stacks.get(id);
  }

  trackBotMessage(chatId, messageId, { pinned = false } = {}) {
    if (!messageId) return;
    const stack = this._stack(chatId);
    if (pinned) {
      stack.pinned.add(messageId);
      return;
    }
    stack.botMessages.push(messageId);
  }

  async flushBotMessages(bot, chatId) {
    const enabled = await SettingsService.getChatCleanup();
    if (!enabled) return 0;

    const stack = this.stacks.get(Number(chatId));
    if (!stack?.botMessages.length) return 0;

    let deleted = 0;
    for (const messageId of stack.botMessages) {
      if (stack.pinned.has(messageId)) continue;
      try {
        await bot.deleteMessage(chatId, messageId);
        deleted++;
      } catch {
        /* message already deleted or too old */
      }
    }
    stack.botMessages = stack.botMessages.filter((id) => stack.pinned.has(id));
    return deleted;
  }

  async deleteUserMessage(bot, chatId, messageId) {
    if (!messageId) return;
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch {
      /* ignore */
    }
  }

  async deleteUserMessageIfEnabled(bot, chatId, messageId) {
    if (!(await SettingsService.getChatCleanup())) return;
    await this.deleteUserMessage(bot, chatId, messageId);
  }

  async consumeUserMessage(bot, msg) {
    if (!msg?.message_id || !msg?.chat?.id) return;
    await this.deleteUserMessageIfEnabled(bot, msg.chat.id, msg.message_id);
  }

  pinMessage(chatId, messageId) {
    this.trackBotMessage(chatId, messageId, { pinned: true });
  }

  markReplyKeyboardReady(chatId) {
    this.replyKeyboardReady.add(Number(chatId));
  }

  hasReplyKeyboard(chatId) {
    return this.replyKeyboardReady.has(Number(chatId));
  }

  clearReplyKeyboard(chatId) {
    this.replyKeyboardReady.delete(Number(chatId));
  }

  async releasePinnedMessage(bot, chatId, messageId) {
    if (!messageId) return;
    const stack = this.stacks.get(Number(chatId));
    if (!stack) return;
    stack.pinned.delete(messageId);
    stack.botMessages = stack.botMessages.filter((id) => id !== messageId);
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch {
      /* already deleted */
    }
  }
}

module.exports = new ChatCleanupService();
