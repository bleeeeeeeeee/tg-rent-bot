const { CHANNEL_ID } = require('../config');
const ExistingPosts = require('./ExistingPosts');
const SummaryService = require('./SummaryService');
const ProcessedPosts = require('./ProcessedPosts');

class ChannelPostService {
  constructor(bot) {
    this.bot = bot;
  }

  static formatEditError(err) {
    const desc = err?.response?.body?.description || err?.message || String(err);
    if (/message can't be edited/i.test(desc)) {
      return 'Telegram не даёт редактировать это сообщение (слишком старое или нет прав «Редактирование»).';
    }
    if (/message to edit not found/i.test(desc) || /message identifier is not specified/i.test(desc)) {
      return 'Сообщение не найдено в канале — возможно, уже удалено.';
    }
    if (/not enough rights/i.test(desc) || /need administrator/i.test(desc)) {
      return 'У бота нет прав редактировать посты. Добавьте право «Редактирование сообщений других пользователей».';
    }
    if (/there is no text in the message to edit/i.test(desc)) {
      return 'У поста нет подписи — редактировать можно только текст/подпись.';
    }
    if (/message is not modified/i.test(desc)) {
      return 'Текст не изменился.';
    }
    return `Не удалось изменить пост: ${desc}`;
  }

  static formatDeleteError(err) {
    const desc = err?.response?.body?.description || err?.message || String(err);
    if (/message to delete not found/i.test(desc)) {
      return 'Сообщение уже удалено из канала.';
    }
    if (/not enough rights/i.test(desc)) {
      return 'У бота нет прав удалять посты. Добавьте право «Удаление сообщений».';
    }
    return `Не удалось удалить: ${desc}`;
  }

  async editText(messageId, newText, { source = 'bot' } = {}) {
    const id = Number(messageId);
    const post = await ExistingPosts.getById(id);
    if (!post) throw new Error('Пост не найден в архиве.');
    if (post.lifecycleStatus === 'deleted') throw new Error('Пост уже помечен как удалённый.');
    if (post.albumPrimaryId && post.albumPrimaryId !== id) {
      throw new Error('Редактируйте основной пост альбома.');
    }

    const text = String(newText ?? '').trim();
    if (!text) throw new Error('Текст не может быть пустым.');

    const opts = {
      chat_id: CHANNEL_ID,
      message_id: id
    };

    if (post.media) {
      await this.bot.editMessageCaption(text, opts);
    } else {
      await this.bot.editMessageText(text, opts);
    }

    const updated = await ExistingPosts.applyEdit(id, text, post.media, new Date().toISOString(), { source });
    await ProcessedPosts.unmarkProcessed(id);
    SummaryService.enrichPost(id, text, { force: true }).catch(console.error);
    return updated;
  }

  async deleteFromChannel(messageId) {
    const id = Number(messageId);
    const post = await ExistingPosts.getById(id);
    if (!post) throw new Error('Пост не найден в архиве.');
    if (post.lifecycleStatus === 'deleted') {
      return post;
    }

    try {
      await this.bot.deleteMessage(CHANNEL_ID, id);
    } catch (err) {
      const desc = err?.response?.body?.description || err?.message || '';
      if (!/message to delete not found/i.test(desc)) {
        throw err;
      }
    }

    return ExistingPosts.markDeleted(id);
  }
}

module.exports = ChannelPostService;
