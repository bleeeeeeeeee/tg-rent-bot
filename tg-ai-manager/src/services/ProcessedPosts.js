const fs = require('fs').promises;
const path = require('path');

const FILE_PATH = path.join(__dirname, '../../storage/processed_posts.json');
const AI_VERSION = 1;

class ProcessedPosts {
  static async _read() {
    try {
      const data = await fs.readFile(FILE_PATH, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed?.entries) return parsed;
      if (parsed?.ids) {
        return {
          entries: parsed.ids.map((id) => ({ id: Number(id), contentHash: null, aiVersion: 1 }))
        };
      }
      return { entries: [] };
    } catch {
      return { entries: [] };
    }
  }

  static async _write(data) {
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  static async getEntry(messageId) {
    const data = await this._read();
    return data.entries.find((e) => e.id === Number(messageId)) || null;
  }

  static async isProcessed(messageId, contentHash = null) {
    const entry = await this.getEntry(messageId);
    if (!entry) return false;
    if (contentHash && entry.contentHash !== contentHash) return false;
    return entry.aiVersion === AI_VERSION;
  }

  static async markProcessed(messageId, contentHash) {
    const data = await this._read();
    const id = Number(messageId);
    const idx = data.entries.findIndex((e) => e.id === id);
    const record = { id, contentHash: contentHash || null, aiVersion: AI_VERSION };

    if (idx === -1) {
      data.entries.push(record);
    } else {
      data.entries[idx] = record;
    }

    data.entries.sort((a, b) => a.id - b.id);
    await this._write(data);
  }

  static async unmarkProcessed(messageId) {
    const data = await this._read();
    const id = Number(messageId);
    data.entries = data.entries.filter((e) => e.id !== id);
    await this._write(data);
  }
}

module.exports = ProcessedPosts;
