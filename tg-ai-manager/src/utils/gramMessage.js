function parseMediaFromExport(msg) {
  if (!msg) return null;
  if (msg.photo) return { type: 'photo', count: 1 };
  if (msg.video_file || msg.file?.endsWith?.('.mp4')) return { type: 'video', count: 1 };
  if (msg.voice_message) return { type: 'voice', count: 1 };
  if (msg.audio_file) return { type: 'audio', count: 1 };
  if (msg.file) return { type: 'document', count: 1 };
  if (msg.sticker) return { type: 'sticker', count: 1 };
  return null;
}

function parseMediaFromGramMessage(msg) {
  if (!msg) return null;
  if (msg.photo) return { type: 'photo', count: 1 };
  if (msg.video) return { type: 'video', count: 1 };
  if (msg.videoNote) return { type: 'video_note', count: 1 };
  if (msg.document) return { type: 'document', count: 1 };
  if (msg.voice) return { type: 'voice', count: 1 };
  if (msg.audio) return { type: 'audio', count: 1 };
  if (msg.animation) return { type: 'animation', count: 1 };
  if (msg.sticker) return { type: 'sticker', count: 1 };
  return null;
}

function extractGramText(msg) {
  if (!msg) return '';
  return String(msg.message || msg.text || '').trim();
}

function isGramServiceMessage(msg) {
  return Boolean(msg?.action);
}

function gramMessageToPostPayload(message) {
  const postText = extractGramText(message);
  const media = parseMediaFromGramMessage(message);
  const added = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();
  const editedAt = message.editDate ? new Date(message.editDate * 1000).toISOString() : null;
  const replyTo = message.replyTo?.replyToMsgId != null ? Number(message.replyTo.replyToMsgId) : null;
  const mediaGroupId = message.groupedId != null ? String(message.groupedId) : null;

  return {
    id: message.id,
    post: postText,
    media,
    replyTo,
    mediaGroupId,
    added,
    lifecycleStatus: editedAt ? 'edited' : 'active',
    editedAt
  };
}

function shouldImportGramMessage(message) {
  if (!message?.id) return false;
  if (isGramServiceMessage(message)) return false;
  const payload = gramMessageToPostPayload(message);
  return Boolean(payload.post?.trim() || payload.media);
}

module.exports = {
  parseMediaFromExport,
  parseMediaFromGramMessage,
  extractGramText,
  isGramServiceMessage,
  gramMessageToPostPayload,
  shouldImportGramMessage
};
