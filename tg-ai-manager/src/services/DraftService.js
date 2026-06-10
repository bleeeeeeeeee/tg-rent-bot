const JsonStore = require('../storage/JsonStore');
const { v4: uuidv4 } = require('uuid');

class DraftService {
  async _read() {
    try {
      return await JsonStore.read('drafts', { drafts: [] });
    } catch {
      return { drafts: [] };
    }
  }

  async _write(data) {
    await JsonStore.write('drafts', data);
  }

  async add(userId, chatId, messageId, { stagingMessageIds, stagedMeta, previewText, media } = {}) {
    const data = await this._read();
    data.drafts.push({
      id: uuidv4(),
      kind: 'post',
      userId: String(userId),
      chatId,
      messageId,
      stagingMessageIds: stagingMessageIds || null,
      stagedMeta: stagedMeta || null,
      previewText: previewText || '',
      media: media || null,
      createdAt: new Date().toISOString()
    });
    await this._write(data);
  }

  async addWizard(userId, { label, snapshot, pinnedMessageIds = [] }) {
    const data = await this._read();
    const draft = {
      id: uuidv4(),
      kind: 'wizard',
      userId: String(userId),
      label: label || 'Мастер ИИ',
      snapshot,
      pinnedMessageIds,
      createdAt: new Date().toISOString()
    };
    data.drafts.push(draft);
    await this._write(data);
    return draft;
  }

  async addTopicNote(userId, topic) {
    const data = await this._read();
    const draft = {
      id: uuidv4(),
      kind: 'topic',
      userId: String(userId),
      label: topic.title?.slice(0, 60) || 'Тема',
      topic: {
        title: topic.title,
        brief: topic.brief,
        angle: topic.angle || '',
        tags: topic.tags || []
      },
      createdAt: new Date().toISOString()
    };
    data.drafts.push(draft);
    await this._write(data);
    return draft;
  }

  async getAll(userId) {
    const data = await this._read();
    return data.drafts.filter((d) => d.userId === String(userId));
  }

  async remove(draftId) {
    const data = await this._read();
    data.drafts = data.drafts.filter((d) => d.id !== draftId);
    await this._write(data);
  }

  async getById(userId, draftId) {
    const data = await this._read();
    return data.drafts.find((d) => d.userId === String(userId) && d.id === draftId) || null;
  }

  async update(draftId, userId, chatId, messageId) {
    const data = await this._read();
    const idx = data.drafts.findIndex((d) => d.id === draftId && d.userId === String(userId));
    if (idx === -1) return null;
    data.drafts[idx].chatId = chatId;
    data.drafts[idx].messageId = messageId;
    data.drafts[idx].updatedAt = new Date().toISOString();
    await this._write(data);
    return data.drafts[idx];
  }
}

module.exports = new DraftService();
