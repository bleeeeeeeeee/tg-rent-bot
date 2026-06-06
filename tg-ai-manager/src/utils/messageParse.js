function extractText(msg) {
  if (!msg) return '';
  let text = '';
  if (msg.text) text += msg.text;
  if (msg.caption) {
    if (text) text += '\n\n';
    text += msg.caption;
  }
  return text;
}

function parseMedia(msg) {
  if (!msg) return null;
  let mediaType = null;
  let mediaCount = 0;

  if (msg.photo?.length) {
    mediaType = 'photo';
    mediaCount = msg.photo.length;
  } else if (msg.video) {
    mediaType = 'video';
    mediaCount = 1;
  } else if (msg.video_note) {
    mediaType = 'video_note';
    mediaCount = 1;
  } else if (msg.audio) {
    mediaType = 'audio';
    mediaCount = 1;
  } else if (msg.voice) {
    mediaType = 'voice';
    mediaCount = 1;
  } else if (msg.document) {
    mediaType = 'document';
    mediaCount = 1;
  } else if (msg.animation) {
    mediaType = 'animation';
    mediaCount = 1;
  } else if (msg.sticker) {
    mediaType = 'sticker';
    mediaCount = 1;
  }

  return mediaType ? { type: mediaType, count: mediaCount } : null;
}

module.exports = { extractText, parseMedia };
