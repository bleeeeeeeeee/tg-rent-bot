const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const HISTORY_FILE = path.join(__dirname, '../storage/history.json');

class HistoryRepository {
    async _read() {
        try {
            const data = await fs.readFile(HISTORY_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { records: [] };
        }
    }

    async _write(data) {
        await fs.writeFile(HISTORY_FILE, JSON.stringify(data, null, 2));
    }

    /**
     * Add a record for a published post.
     * @param {string} userId  - who triggered the publication (may be empty)
     * @param {number|string} chatId - source chat id (usually channel)
     * @param {number} messageId - original message id in channel
     * @param {object} summary - ai summary fields
     * @param {string|number|null} [publishedAt] - optional timestamp (unix or ISO) to keep original send date
     */
    async addPublished(userId, chatId, messageId, summary = {}, publishedAt = null) {
        const data = await this._read();
        summary = summary || {};
        data.records.push({
            id: uuidv4(),
            userId: String(userId),
            chatId,
            messageId,
            publishedAt: publishedAt
                ? new Date(publishedAt).toISOString()
                : new Date().toISOString(),
            title: summary.title || '',
            main: summary.main || '',
            description: summary.description || '',
            keywords: summary.keywords || []
        });
        await this._write(data);
    }

    async getAll() {
        const data = await this._read();
        // newest first
        return data.records.sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    }

    async updateSummary(messageId, summary) {
        const data = await this._read();
        const rec = data.records.find(r => r.messageId === messageId);
        if (rec && summary) {
            if (summary.title) rec.title = summary.title;
            if (summary.main) rec.main = summary.main;
            if (summary.description) rec.description = summary.description;
            if (summary.keywords) rec.keywords = summary.keywords;
            await this._write(data);
        }
    }
}

module.exports = new HistoryRepository();