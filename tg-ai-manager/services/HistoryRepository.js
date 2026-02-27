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
    async addPublished(userId, chatId, messageId, summary = {}, publishedAt = null, groupId = null, replyTo = null) {
        const data = await this._read();
        summary = summary || {};
        // avoid duplicate records: check by groupId if provided, else by messageId
        const existing = data.records.find(r => {
            if (groupId && r.groupId) return r.groupId === groupId;
            return r.chatId === chatId && Number(r.messageId) === Number(messageId);
        });
        if (existing) {
            // update summary fields if provided
            if (summary.title) existing.title = summary.title;
            if (summary.main) existing.main = summary.main;
            if (summary.description) existing.description = summary.description;
            if (summary.keywords) existing.keywords = summary.keywords;
            await this._write(data);
            return;
        }
        data.records.push({
            id: uuidv4(),
            userId: String(userId),
            chatId,
            messageId,
            groupId: groupId || null,
            replyTo: replyTo || null,
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
        // remove duplicates: same groupId (if set) or same chatId/messageId
        const seen = new Set();
        const unique = [];
        for (const r of data.records) {
            const key = r.groupId ? `g:${r.groupId}` : `m:${r.chatId}:${r.messageId}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(r);
            }
        }
        if (unique.length !== data.records.length) {
            data.records = unique;
            await this._write(data);
        }
        // oldest first by default (первые посты в начале)
        return unique.sort((a,b) => new Date(a.publishedAt) - new Date(b.publishedAt));
    }

    async updateSummary(messageId, summary) {
        const data = await this._read();
        const rec = data.records.find(r => r.messageId === messageId || r.groupId === messageId);
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