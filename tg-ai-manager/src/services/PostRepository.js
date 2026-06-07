const JsonStore = require('../storage/JsonStore');
const { v4: uuidv4 } = require('uuid');

class PostRepository {
  async _read() {
    try {
      return await JsonStore.read('scheduled', { posts: [] });
    } catch {
      return { posts: [] };
    }
  }

  async _write(data) {
    await JsonStore.write('scheduled', data);
  }

  async addScheduled(userId, chatId, messageId, publishAt, meta = {}) {
    const data = await this._read();
    data.posts.push({
      id: uuidv4(),
      userId: String(userId),
      chatId,
      messageId,
      publishAt,
      preview: meta.preview || '',
      media: meta.media || null,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    await this._write(data);
  }

  async getDueScheduled() {
    const data = await this._read();
    const now = new Date();
    return data.posts.filter(
      (p) => p.status === 'pending' && new Date(p.publishAt) <= now
    );
  }

  async getAllPending() {
    const data = await this._read();
    return data.posts
      .filter((p) => p.status === 'pending')
      .sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  }

  async getById(id) {
    const data = await this._read();
    return data.posts.find((p) => p.id === id) || null;
  }

  async markAsPublished(id) {
    const data = await this._read();
    const post = data.posts.find((p) => p.id === id);
    if (post) {
      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      await this._write(data);
    }
  }

  async markAsFailed(id, reason = '') {
    const data = await this._read();
    const post = data.posts.find((p) => p.id === id);
    if (post) {
      post.status = 'failed';
      post.failReason = reason;
      post.failedAt = new Date().toISOString();
      await this._write(data);
    }
  }

  async updatePublishAt(id, publishAt) {
    const data = await this._read();
    const post = data.posts.find((p) => p.id === id);
    if (!post || post.status !== 'pending') return null;
    post.publishAt = publishAt;
    await this._write(data);
    return post;
  }

  async removeScheduled(id) {
    const data = await this._read();
    data.posts = data.posts.filter((p) => p.id !== id);
    await this._write(data);
  }
}

module.exports = new PostRepository();
