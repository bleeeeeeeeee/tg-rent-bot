const fs = require('fs').promises;
const path = require('path');

const FILE_PATH = path.join(__dirname, '../storage/existing_posts.json');

class ExistingPosts {
    static async _read() {
        try {
            const data = await fs.readFile(FILE_PATH, 'utf8');
            return JSON.parse(data);
        } catch {
            return { posts: [] };
        }
    }

    static async _write(data) {
        await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    }

    /**
     * Добавляет пост в список существующих постов
     * @param {number} messageId - ID сообщения в канале
     * @param {string} text - Текст сообщения
     * @param {object} media - Информация о медиа { type, count }
     * @param {number|null} replyTo - ID сообщения, на которое это ответ (если есть)
     */
    static async addPost(messageId, text, media = null, replyTo = null) {
        const data = await this._read();

        // Конвертируем messageId в число для корректного сравнения
        const id = Number(messageId);
        const exists = data.posts.find(p => p.messageId === id);
        if (exists) {
            return exists;
        }

        const post = {
            messageId: id,
            text: String(text || ''),
            media,
            replyTo: replyTo ? Number(replyTo) : null,
            addedAt: new Date().toISOString()
        };

        data.posts.push(post);
        await this._write(data);
        return post;
    }

    /**
     * Получает все посты
     */
    static async getAll() {
        const data = await this._read();
        return data.posts;
    }

    /**
     * Получает пост по ID
     */
    static async getById(messageId) {
        const data = await this._read();
        return data.posts.find(p => p.messageId === Number(messageId));
    }

    /**
     * Удаляет пост
     */
    static async removePost(messageId) {
        const data = await this._read();
        data.posts = data.posts.filter(p => p.messageId !== Number(messageId));
        await this._write(data);
    }

    /**
     * Проверяет, существует ли пост
     */
    static async exists(messageId) {
        const post = await this.getById(messageId);
        return !!post;
    }
}

module.exports = ExistingPosts;
