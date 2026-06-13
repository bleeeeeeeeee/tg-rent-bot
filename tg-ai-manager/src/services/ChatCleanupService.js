const UserSettingsService = require('./UserSettingsService');

class ChatCleanupService {
  constructor() {
    /** @type {Map<number, { ephemeral: number[], pinned: Set<number> }>} */
    this.stacks = new Map();
    this.replyKeyboardReady = new Set();
  }

  _stack(chatId) {
    const id = Number(chatId);
    if (!this.stacks.has(id)) {
      this.stacks.set(id, { ephemeral: [], pinned: new Set() });
    }
    return this.stacks.get(id);
  }

  resetChat(chatId) {
    const id = Number(chatId);
    this.stacks.delete(id);
    this.replyKeyboardReady.delete(id);
  }

  trackBotMessage(chatId, messageId, { pinned = false } = {}) {
    if (!messageId) return;
    const stack = this._stack(chatId);
    if (pinned) {
      stack.pinned.add(messageId);
      stack.ephemeral = stack.ephemeral.filter((id) => id !== messageId);
      return;
    }
    if (stack.pinned.has(messageId)) return;
    if (!stack.ephemeral.includes(messageId)) {
      stack.ephemeral.push(messageId);
    }
  }

  snapshotEphemeral(chatId) {
    const stack = this.stacks.get(Number(chatId));
    if (!stack) return [];
    return [...stack.ephemeral];
  }

  clearEphemeral(chatId) {
    const stack = this.stacks.get(Number(chatId));
    if (stack) stack.ephemeral = [];
  }

  async deleteMessages(bot, chatId, messageIds, { keepPinned = true } = {}) {
    if (!messageIds?.length) return 0;
    const stack = this.stacks.get(Number(chatId));
    const unique = [...new Set(messageIds.filter(Boolean))];
    let deleted = 0;

    for (const messageId of unique) {
      if (keepPinned && stack?.pinned.has(messageId)) continue;
      try {
        await bot.deleteMessage(chatId, messageId);
        deleted++;
      } catch {
        /* already gone or too old */
      }
      if (stack) {
        stack.pinned.delete(messageId);
        stack.ephemeral = stack.ephemeral.filter((id) => id !== messageId);
      }
    }

    return deleted;
  }

  async _chatCleanupEnabled(chatId) {
    return UserSettingsService.getChatCleanup(chatId);
  }

  async flushBotMessages(bot, chatId, { except = [] } = {}) {
    const enabled = await this._chatCleanupEnabled(chatId);
    if (!enabled) return 0;

    const exceptSet = new Set((except || []).filter(Boolean));
    const stack = this.stacks.get(Number(chatId));
    if (!stack?.ephemeral.length) return 0;

    const toDelete = stack.ephemeral.filter((id) => !exceptSet.has(id) && !stack.pinned.has(id));
    stack.ephemeral = stack.ephemeral.filter((id) => exceptSet.has(id) || stack.pinned.has(id));
    return this.deleteMessages(bot, chatId, toDelete, { keepPinned: true });
  }

  async deleteUserMessage(bot, chatId, messageId) {
    if (!messageId) return;
    await this.deleteMessages(bot, chatId, [messageId], { keepPinned: false });
  }

  async deleteUserMessageIfEnabled(bot, chatId, messageId) {
    if (!(await this._chatCleanupEnabled(chatId))) return;
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
    if (stack) {
      stack.pinned.delete(messageId);
      stack.ephemeral = stack.ephemeral.filter((id) => id !== messageId);
    }
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch {
      /* already deleted */
    }
  }

  async ensureReplyKeyboard(bot, chatId, replyMarkup) {
    if (!replyMarkup) return false;
    if (this.hasReplyKeyboard(chatId)) return true;

    let placeholder;
    try {
      placeholder = await bot.sendMessage(chatId, '\u200b', {
        reply_markup: replyMarkup
      });
      this.markReplyKeyboardReady(chatId);
    } catch (err) {
      console.error('[ChatCleanupService] ensureReplyKeyboard send failed:', err.message);
      return false;
    }

    if (placeholder?.message_id) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await bot.deleteMessage(chatId, placeholder.message_id);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 120));
        }
      }
    }
    return true;
  }
}

module.exports = new ChatCleanupService();
