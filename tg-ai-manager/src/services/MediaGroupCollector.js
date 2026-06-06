const MEDIA_GROUP_WAIT_MS = 900;

class MediaGroupCollector {
  constructor() {
    this.buffers = new Map();
  }

  _key(userId, groupId) {
    return `${userId}:${groupId}`;
  }

  push(userId, msg, onComplete) {
    const groupId = msg.media_group_id;
    if (!groupId) return false;

    const key = this._key(userId, groupId);
    const entry = this.buffers.get(key) || { msgs: [], onComplete };
    entry.msgs.push(msg);
    entry.onComplete = onComplete;

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.buffers.delete(key);
      const sorted = [...entry.msgs].sort((a, b) => a.message_id - b.message_id);
      entry.onComplete(sorted).catch(console.error);
    }, MEDIA_GROUP_WAIT_MS);

    this.buffers.set(key, entry);
    return true;
  }

  cancelForUser(userId) {
    for (const [key, entry] of this.buffers.entries()) {
      if (key.startsWith(`${userId}:`)) {
        if (entry.timer) clearTimeout(entry.timer);
        this.buffers.delete(key);
      }
    }
  }
}

module.exports = new MediaGroupCollector();
