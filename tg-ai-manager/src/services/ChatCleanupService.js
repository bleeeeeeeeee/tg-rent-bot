const UserSettingsService = require('./UserSettingsService');

const MAX_PERSISTED = 48;

class ChatCleanupService {
  constructor() {
    /** @type {Map<number, { ephemeral: number[], transient: number[], pinned: Set<number> }>} */
    this.stacks = new Map();
    this.replyKeyboardReady = new Set();
    this._persistTimers = new Map();
  }

  _stack(chatId) {
    const id = Number(chatId);
    if (!this.stacks.has(id)) {
      this.stacks.set(id, { ephemeral: [], transient: [], pinned: new Set() });
    }
    return this.stacks.get(id);
  }

  resetChat(chatId) {
    const id = Number(chatId);
    this.stacks.delete(id);
    this.replyKeyboardReady.delete(id);
    if (this._persistTimers.has(id)) {
      clearTimeout(this._persistTimers.get(id));
      this._persistTimers.delete(id);
    }
  }

  _collectPersistIds(chatId) {
    const stack = this.stacks.get(Number(chatId));
    if (!stack) return [];
    return [...new Set([...stack.ephemeral, ...stack.transient])].slice(-MAX_PERSISTED);
  }

  _schedulePersist(chatId) {
    const id = Number(chatId);
    if (this._persistTimers.has(id)) return;
    const timer = setTimeout(() => {
      this._persistTimers.delete(id);
      const ids = this._collectPersistIds(id);
      UserSettingsService.setCleanupMessageIds(id, ids).catch(() => {});
    }, 400);
    this._persistTimers.set(id, timer);
  }

  trackBotMessage(chatId, messageId, { pinned = false, transient = false } = {}) {
    if (!messageId) return;
    const stack = this._stack(chatId);
    if (pinned) {
      stack.pinned.add(messageId);
      stack.ephemeral = stack.ephemeral.filter((id) => id !== messageId);
      stack.transient = stack.transient.filter((id) => id !== messageId);
      this._schedulePersist(chatId);
      return;
    }
    if (stack.pinned.has(messageId)) return;
    if (transient) {
      if (!stack.transient.includes(messageId)) stack.transient.push(messageId);
      this._schedulePersist(chatId);
      return;
    }
    if (!stack.ephemeral.includes(messageId)) {
      stack.ephemeral.push(messageId);
    }
    this._schedulePersist(chatId);
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
        stack.transient = stack.transient.filter((id) => id !== messageId);
      }
    }

    this._schedulePersist(chatId);
    return deleted;
  }

  async _chatCleanupEnabled(chatId) {
    return UserSettingsService.getChatCleanup(chatId);
  }

  async flushTransient(bot, chatId) {
    const stack = this.stacks.get(Number(chatId));
    if (!stack?.transient?.length) return 0;
    const ids = [...stack.transient];
    stack.transient = [];
    return this.deleteMessages(bot, chatId, ids, { keepPinned: false });
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

  /**
   * Удаляет все отслеживаемые UI-сообщения бота (в памяти + сохранённые в настройках).
   * Не трогает закреплённые staging/preview (их снимает clearState).
   */
  async flushSession(bot, chatId, { keepPinned = true } = {}) {
    const enabled = await this._chatCleanupEnabled(chatId);
    if (!enabled) {
      this.resetChat(chatId);
      return 0;
    }

    const stack = this.stacks.get(Number(chatId));
    const pinned = stack?.pinned || new Set();
    const persisted = await UserSettingsService.getCleanupMessageIds(chatId);
    const inMemory = stack ? [...stack.ephemeral, ...stack.transient] : [];
    const toDelete = [...new Set([...persisted, ...inMemory])].filter(
      (id) => !keepPinned || !pinned.has(id)
    );

    await this.deleteMessages(bot, chatId, toDelete, { keepPinned: false });
    await UserSettingsService.setCleanupMessageIds(chatId, []);

    if (stack) {
      stack.ephemeral = [];
      stack.transient = [];
    }

    return toDelete.length;
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
      stack.transient = stack.transient.filter((id) => id !== messageId);
    }
    try {
      await bot.deleteMessage(chatId, messageId);
    } catch {
      /* already deleted */
    }
    this._schedulePersist(chatId);
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
