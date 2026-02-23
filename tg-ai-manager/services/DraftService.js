const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DRAFTS_FILE = path.join(__dirname, '../storage/drafts.json');

class DraftService {
    async _read() {
        try {
            const data = await fs.readFile(DRAFTS_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { drafts: [] };
        }
    }

    async _write(data) {
        await fs.writeFile(DRAFTS_FILE, JSON.stringify(data, null, 2));
    }

    async add(userId, chatId, messageId) {
        const data = await this._read();
        data.drafts.push({ id: uuidv4(), userId: String(userId), chatId, messageId, createdAt: new Date().toISOString() });
        await this._write(data);
    }

    async getAll(userId) {
        const data = await this._read();
        return data.drafts.filter(d => d.userId === String(userId));
    }

    async remove(draftId) {
        const data = await this._read();
        data.drafts = data.drafts.filter(d => d.id !== draftId);
        await this._write(data);
    }

    async getById(userId, draftId) {
        const data = await this._read();
        return data.drafts.find(d => d.userId === String(userId) && d.id === draftId) || null;
    }

    async update(draftId, userId, chatId, messageId) {
        const data = await this._read();
        const idx = data.drafts.findIndex(d => d.id === draftId && d.userId === String(userId));
        if (idx === -1) return null;
        data.drafts[idx].chatId = chatId;
        data.drafts[idx].messageId = messageId;
        data.drafts[idx].updatedAt = new Date().toISOString();
        await this._write(data);
        return data.drafts[idx];
    }
}

module.exports = new DraftService();