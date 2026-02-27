// helper to identify the predominant media type of a Telegram message
// returns a short Russian label such as 'фото', 'видео', 'аудио' etc.

function detect(msg) {
    if (!msg || typeof msg !== 'object') return 'медиа';
    if (msg.photo) return 'фото';
    if (msg.video) return 'видео';
    if (msg.audio) return 'аудио';
    if (msg.voice) return 'голос';
    if (msg.document) return 'документ';
    if (msg.sticker) return 'стикер';
    // other types could be added (animation, video_note, etc.)
    return 'медиа';
}

module.exports = { detect };