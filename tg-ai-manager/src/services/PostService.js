const { CHANNEL_ID } = require('../config');
const ExistingPosts = require('./ExistingPosts');
const SummaryService = require('./SummaryService');
const { extractText, parseMedia } = require('../utils/messageParse');

function normalizeCopiedMessages(result) {
  const list = Array.isArray(result) ? result : result?.result || [];
  return list
    .map((item) => {
      if (typeof item === 'number') return item;
      if (item?.message_id != null) return Number(item.message_id);
      return null;
    })
    .filter(Boolean);
}

class PostService {
  constructor(bot) {
    this.bot = bot;
  }

  static formatPublishError(err) {
    const desc = err?.response?.body?.description || err?.message || String(err);
    if (/message to copy not found/i.test(desc)) {
      return (
        'Исходное сообщение не найдено — возможно, оно уже удалено из чата. ' +
        'Отправьте пост заново через «Публикация».'
      );
    }
    if (/chat not found/i.test(desc)) {
      return 'Канал не найден. Проверьте CHANNEL_ID в .env и права бота в канале.';
    }
    if (/not enough rights/i.test(desc) || /need administrator/i.test(desc)) {
      return 'У бота нет прав публиковать в канал. Добавьте бота админом с правом публикации.';
    }
    return `Не удалось опубликовать: ${desc}`;
  }

  static isSourceMissing(err) {
    const desc = err?.response?.body?.description || err?.message || '';
    return /message to copy not found/i.test(desc);
  }

  async publish(userId, chatId, messageId, { messageIds, stagedMeta } = {}) {
    const ids = messageIds?.length ? messageIds : [messageId];
    console.log(`\n[PostService] 📤 Publishing ${ids.length} message(s)...`);

    if (ids.length === 1) {
      return this._publishSingle(chatId, ids[0]);
    }

    const copied = await this.bot.copyMessages(CHANNEL_ID, chatId, ids);
    const channelIds = normalizeCopiedMessages(copied);
    if (channelIds.length !== ids.length) {
      throw new Error(`Скопировано ${channelIds.length} из ${ids.length} сообщений`);
    }
    const mediaGroupId = channelIds.length > 1 ? String(channelIds[0]) : null;
    console.log(`[PostService] ✅ Copied album to channel: ${channelIds.join(', ')}`);

    let firstMsg = null;
    for (let i = 0; i < channelIds.length; i++) {
      const channelMsgId = channelIds[i];
      const meta = stagedMeta?.[i];
      const fullText = i === 0 ? (meta?.text || '') : '';
      const media = meta?.media || null;
      const added = await ExistingPosts.addPost(
        channelMsgId,
        fullText,
        media,
        null,
        mediaGroupId
      );
      if (added && i === 0 && fullText.trim()) {
        SummaryService.enrichPost(channelMsgId, fullText).catch(console.error);
      }
      if (i === 0) firstMsg = { message_id: channelMsgId };
    }

    return firstMsg || { message_id: channelIds[0] };
  }

  async _publishSingle(chatId, messageId) {
    console.log(`[PostService] 📤 Publishing #${messageId}...`);

    const channelMsg = await this.bot.copyMessage(CHANNEL_ID, chatId, messageId);
    const channelMsgId = channelMsg.message_id;
    console.log(`[PostService] ✅ Copied to channel #${channelMsgId}`);

    const fullText = extractText(channelMsg);
    const media = parseMedia(channelMsg);
    const replyToId = channelMsg.reply_to_message
      ? channelMsg.reply_to_message.message_id
      : null;

    const mediaGroupId = channelMsg.media_group_id ? String(channelMsg.media_group_id) : null;

    const added = await ExistingPosts.addPost(channelMsgId, fullText, media, replyToId, mediaGroupId);
    if (added) {
      console.log(`[PostService] ✅ Post #${channelMsgId} added to DB`);
      SummaryService.enrichPost(channelMsgId, fullText).catch(console.error);
    }

    return channelMsg;
  }
}

module.exports = PostService;
