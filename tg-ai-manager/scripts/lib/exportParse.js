function parseMediaFromExport(msg) {
  if (msg.photo) return { type: 'photo', count: 1 };
  if (msg.video_file || msg.file?.endsWith?.('.mp4')) return { type: 'video', count: 1 };
  if (msg.voice_message) return { type: 'voice', count: 1 };
  if (msg.audio_file) return { type: 'audio', count: 1 };
  if (msg.file) return { type: 'document', count: 1 };
  if (msg.sticker) return { type: 'sticker', count: 1 };
  return null;
}

function parseMediaFromGramMessage(msg) {
  if (msg.photo) return { type: 'photo', count: 1 };
  if (msg.video) return { type: 'video', count: 1 };
  if (msg.document) return { type: 'document', count: 1 };
  if (msg.voice) return { type: 'voice', count: 1 };
  if (msg.audio) return { type: 'audio', count: 1 };
  if (msg.sticker) return { type: 'sticker', count: 1 };
  return null;
}

function extractGramText(msg) {
  return msg.message || msg.text || '';
}

module.exports = { parseMediaFromExport, parseMediaFromGramMessage, extractGramText };
