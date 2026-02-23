const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SCHEDULED_FILE = path.join(__dirname, '../storage/scheduled.json');

class PostRepository {
    async _read() {
        try {
            const data = await fs.readFile(SCHEDULED_FILE, 'utf-8');
            return JSON.parse(data);
        } catch {
            return { posts: [] };
        }
    }

    async _write(data) {
        await fs.writeFile(SCHEDULED_FILE, JSON.stringify(data, null, 2));
    }

    async addScheduled(userId, chatId, messageId, publishAt) {
        const data = await this._read();
        data.posts.push({
            id: uuidv4(),
            userId: String(userId),
            chatId,
            messageId,
            publishAt,
            status: 'pending',
            createdAt: new Date().toISOString()
        });
        await this._write(data);
    }

    async getScheduled() {
        const data = await this._read();
        const now = new Date();
        return data.posts.filter(p => p.status === 'pending' && new Date(p.publishAt) <= now);
    }

    async markAsPublished(id) {
        const data = await this._read();
        const post = data.posts.find(p => p.id === id);
        if (post) {
            post.status = 'published';
            post.publishedAt = new Date().toISOString();
            await this._write(data);
        }
    }

    async removeScheduled(id) {
        const data = await this._read();
        data.posts = data.posts.filter(p => p.id !== id);
        await this._write(data);
    }
}

module.exports = new PostRepository();