const { parseMedia } = require('./messageParse');

/** Лимиты Telegram Bot API */
const MEDIA_GROUP_MAX = 10;
const CAPTION_MAX_LENGTH = 1024;

const ALBUM_MEDIA_TYPES = new Set(['photo', 'video', 'animation']);

function extractMediaItem(msg) {
  if (!msg) return null;
  if (msg.photo?.length) {
    return {
      type: 'photo',
      fileId: msg.photo[msg.photo.length - 1].file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.animation) {
    return {
      type: 'animation',
      fileId: msg.animation.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.document) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.voice) {
    return {
      type: 'voice',
      fileId: msg.voice.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  if (msg.video_note) {
    return {
      type: 'video_note',
      fileId: msg.video_note.file_id,
      sourceMessageId: msg.message_id,
      media: parseMedia(msg)
    };
  }
  return null;
}

function isMediaMessage(msg) {
  return Boolean(extractMediaItem(msg));
}

function summarizeMediaCollection(items) {
  if (!items?.length) return null;
  if (items.length === 1) return items[0].media || { type: items[0].type, count: 1 };
  const primary = items.find((i) => ALBUM_MEDIA_TYPES.has(i.type)) || items[0];
  return { type: primary.type, count: items.length };
}

function validateMediaCollection(items) {
  if (!items?.length) return { ok: true };

  if (items.length > MEDIA_GROUP_MAX) {
    return {
      ok: false,
      error: `В Telegram в одной группе — не более ${MEDIA_GROUP_MAX} медиафайлов.`
    };
  }

  const types = items.map((i) => i.type);
  const soloOnly = types.filter((t) => t === 'video_note' || t === 'voice');
  if (soloOnly.length && items.length > 1) {
    return {
      ok: false,
      error: 'Голосовые сообщения и видео-кружки нельзя объединять с другими файлами (лимит Telegram).'
    };
  }

  const hasAlbum = types.some((t) => ALBUM_MEDIA_TYPES.has(t));
  const hasDocument = types.includes('document');
  const hasAudio = types.includes('audio');

  if (hasAlbum && (hasDocument || hasAudio)) {
    return {
      ok: false,
      error: 'Фото/видео нельзя отправить в одном посте с документами или аудио (лимит Telegram).'
    };
  }

  if (hasDocument && hasAudio) {
    return {
      ok: false,
      error: 'Документы и аудио нельзя объединить в одной группе (лимит Telegram).'
    };
  }

  return { ok: true };
}

function validateMediaAdd(items, item) {
  if (!item) {
    return { ok: false, error: 'Не удалось распознать медиа.' };
  }
  return validateMediaCollection([...(items || []), item]);
}

function buildSendMediaGroupInput(items, captionHtml) {
  return items.map((item, index) => {
    const base = index === 0 && captionHtml
      ? { caption: captionHtml, parse_mode: 'HTML' }
      : {};

    if (item.type === 'photo') return { type: 'photo', media: item.fileId, ...base };
    if (item.type === 'video') return { type: 'video', media: item.fileId, ...base };
    if (item.type === 'animation') return { type: 'animation', media: item.fileId, ...base };
    if (item.type === 'document') return { type: 'document', media: item.fileId, ...base };
    if (item.type === 'audio') return { type: 'audio', media: item.fileId, ...base };
    throw new Error(`Unsupported media group type: ${item.type}`);
  });
}

module.exports = {
  MEDIA_GROUP_MAX,
  CAPTION_MAX_LENGTH,
  extractMediaItem,
  isMediaMessage,
  summarizeMediaCollection,
  validateMediaCollection,
  validateMediaAdd,
  buildSendMediaGroupInput
};
