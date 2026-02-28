const fs = require('fs').promises;
const path = require('path');
const SummaryService = require('./SummaryService');
const MediaType = require('./MediaType');

class HistoryService {
    constructor() {
        this.filePath = path.join(__dirname, '../storage/history.json');
        this.channelUrlPrefix = null;
        this.ensureFile();
    }

    async ensureFile() {
        try {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            try {
                await fs.access(this.filePath);
                const content = await fs.readFile(this.filePath, 'utf8');
                JSON.parse(content);
            } catch {
                await fs.writeFile(this.filePath, JSON.stringify({ posts: [] }, null, 2));
            }
        } catch (error) {
            console.error('Ошибка создания файла истории:', error);
        }
    }

    async read() {
        try {
            const data = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(data);
            return {
                posts: Array.isArray(parsed?.posts) ? parsed.posts : []
            };
        } catch {
            return { posts: [] };
        }
    }

    async write(data) {
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    }

    setChannelUrl(prefix) {
        this.channelUrlPrefix = prefix;
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    countMedia(msg) {
        let count = 0;
        if (msg.photo) count += msg.photo.length;
        if (msg.video) count += 1;
        if (msg.audio) count += 1;
        if (msg.voice) count += 1;
        if (msg.document) count += 1;
        if (msg.sticker) count += 1;
        if (msg.animation) count += 1;
        if (msg.video_note) count += 1;
        if (count === 0 && (msg.text || msg.caption)) count = 1;
        return count;
    }

    getMediaTypeTitle(type, count) {
        const titles = {
            'фото': count > 1 ? `📷 Альбом (${count} фото)` : '📷 Фотография',
            'видео': count > 1 ? `🎥 Видео (${count} шт)` : '🎥 Видео',
            'аудио': count > 1 ? `🎵 Аудио (${count} шт)` : '🎵 Аудио',
            'голос': '🎤 Голосовое сообщение',
            'документ': count > 1 ? `📄 Документы (${count} шт)` : '📄 Документ',
            'стикер': '😊 Стикер',
            'gif': '🎞️ GIF',
            'видеосообщение': '📹 Видеосообщение',
            'текст': '📝 Текстовый пост'
        };
        return titles[type] || `📎 Медиа (${count} файлов)`;
    }

    getMediaTypeDescription(type, count) {
        const desc = {
            'фото': 'Фотография',
            'видео': 'Видеозапись',
            'аудио': 'Аудиозапись',
            'голос': 'Голосовое сообщение',
            'документ': 'Документ',
            'стикер': 'Стикер',
            'gif': 'Анимированное изображение',
            'видеосообщение': 'Кружок',
            'текст': 'Текстовый пост'
        };
        return count > 1 ? `${desc[type] || 'Медиа'} (${count} файлов)` : (desc[type] || 'Медиа');
    }

    async addOrUpdatePost(messageData) {
        const data = await this.read();
        const messageId = messageData.message_id;
        const chatId = messageData.chat.id;
        const mediaGroupId = messageData.media_group_id || null;
        
        const mediaType = MediaType.detect(messageData);
        const mediaCount = this.countMedia(messageData);
        
        const text = (messageData.text || '') + (messageData.caption ? '\n' + messageData.caption : '');
        
        let summary = null;
        if (text.trim()) {
            summary = await SummaryService.summarize(text);
        }

        if (mediaGroupId) {
            const existingGroupPost = data.posts.find(p => p.mediaGroupId === mediaGroupId && !p.isDeleted);
            
            if (existingGroupPost) {
                existingGroupPost.mediaCount += mediaCount;
                if (!existingGroupPost.mediaTypes.includes(mediaType)) {
                    existingGroupPost.mediaTypes.push(mediaType);
                }
                existingGroupPost.lastUpdated = new Date().toISOString();
                
                if (text.trim() && summary) {
                    existingGroupPost.title = summary.title || existingGroupPost.title;
                    existingGroupPost.main = summary.main || existingGroupPost.main;
                    existingGroupPost.description = summary.description || existingGroupPost.description;
                    existingGroupPost.keywords = [...new Set([...(existingGroupPost.keywords || []), ...(summary.keywords || [])])];
                }
                
                await this.write(data);
                return existingGroupPost;
            }
        }

        const newPost = {
            id: this.generateId(),
            messageId: messageId,
            chatId: String(chatId),
            title: summary?.title || this.getMediaTypeTitle(mediaType, mediaCount),
            main: summary?.main || this.getMediaTypeDescription(mediaType, mediaCount),
            description: summary?.description || this.getMediaTypeDescription(mediaType, mediaCount),
            publishedAt: messageData.date ? new Date(messageData.date * 1000).toISOString() : new Date().toISOString(),
            mediaGroupId: mediaGroupId,
            replyToMessageId: messageData.reply_to_message?.message_id || null,
            mediaCount: mediaCount,
            mediaTypes: [mediaType],
            keywords: summary?.keywords || [],
            lastUpdated: new Date().toISOString(),
            isDeleted: false
        };

        data.posts.push(newPost);
        await this.write(data);
        return newPost;
    }

    async markAsDeleted(messageId) {
        const data = await this.read();
        const index = data.posts.findIndex(p => p.messageId === messageId);
        if (index >= 0) {
            data.posts[index].isDeleted = true;
            data.posts[index].lastUpdated = new Date().toISOString();
            await this.write(data);
            return true;
        }
        return false;
    }

    async updateSummary(messageId, newText) {
        const data = await this.read();
        const post = data.posts.find(p => p.messageId === messageId && !p.isDeleted);
        
        if (!post) return null;
        
        const summary = await SummaryService.summarize(newText);
        if (!summary) return null;
        
        post.title = summary.title || post.title;
        post.main = summary.main || post.main;
        post.description = summary.description || post.description;
        post.keywords = [...new Set([...(post.keywords || []), ...(summary.keywords || [])])];
        post.lastUpdated = new Date().toISOString();
        
        await this.write(data);
        return post;
    }

    async getAllPosts() {
        const data = await this.read();
        if (!data || !data.posts || !Array.isArray(data.posts)) {
            return [];
        }
        return data.posts
            .filter(p => p && !p.isDeleted)
            .sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
    }

    async searchPosts(query) {
        const posts = await this.getAllPosts();
        if (!query) return posts;
        
        const q = query.toLowerCase();
        return posts.filter(p => 
            p.title?.toLowerCase().includes(q) ||
            p.main?.toLowerCase().includes(q) ||
            p.description?.toLowerCase().includes(q) ||
            p.keywords?.some(k => k.toLowerCase().includes(q))
        );
    }

    formatPostForDisplay(post) {
        const lines = [];
        
        lines.push(`*${post.title}*`);
        
        if (post.replyToMessageId) {
            const link = this.channelUrlPrefix ? `${this.channelUrlPrefix}/${post.replyToMessageId}` : '';
            lines.push(`(ответ на пост ${post.replyToMessageId}${link ? ` [↪](${link})` : ''})`);
        }
        
        if (post.main && post.main !== post.title) {
            lines.push(post.main);
        }
        
        if (post.description && post.description !== post.main) {
            lines.push(post.description);
        }
        
        const date = new Date(post.publishedAt);
        const formattedDate = new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Minsk',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
        lines.push(formattedDate);
        
        if (this.channelUrlPrefix) {
            lines.push(`[Ссылка на пост](${this.channelUrlPrefix}/${post.messageId})`);
        }
        
        return lines.join('\n');
    }

    async getHistoryText(query = null) {
        const posts = query ? await this.searchPosts(query) : await this.getAllPosts();
        
        if (posts.length === 0) {
            return query ? '❌ Записей с таким запросом нет.' : '📭 История публикаций пуста.';
        }

        const header = `📋 *История публикаций*${query ? ` (по «${query}») ` : ' '}– всего ${posts.length} ${posts.length === 1 ? 'запись' : 'записей'} (старые сверху, новые снизу)`;
        
        const postsText = posts
            .sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt))
            .map(p => this.formatPostForDisplay(p))
            .join('\n\n');

        return header + '\n\n' + postsText;
    }

    async exportToCSV() {
        const posts = await this.getAllPosts();
        const headers = ['publishedAt', 'messageId', 'title', 'main', 'description', 'keywords', 'mediaTypes', 'mediaCount', 'replyToMessageId'];
        
        const rows = posts.map(p => [
            p.publishedAt,
            p.messageId,
            p.title,
            p.main,
            p.description,
            (p.keywords || []).join('|'),
            (p.mediaTypes || []).join(','),
            p.mediaCount,
            p.replyToMessageId || ''
        ].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','));

        return [headers.join(','), ...rows].join('\n');
    }
}

module.exports = new HistoryService();