const JsonStore = require('../storage/JsonStore');
const { computeContentHash } = require('../utils/contentHash');
const {
  pickAlbumPrimary,
  isMediaOnly,
  inferAlbumPrimaryId,
  isEmptyPost
} = require('../utils/albumPosts');

const SCHEMA_VERSION = 3;

function normalizePost(raw) {
  const post = raw.post ?? raw['описание'] ?? raw.text ?? '';
  const replyToRaw = raw.replyTo ?? raw['ответНа'] ?? null;

  return {
    id: Number(raw.id),
    post,
    postOriginal: raw.postOriginal ?? null,
    title: raw.title ?? raw['тема'] ?? '',
    mainIdea: raw.mainIdea ?? raw['главнаяМысль'] ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    category: raw.category ?? '',
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    media: raw.media ?? raw['медиа'] ?? null,
    mediaGroupId: raw.mediaGroupId ? String(raw.mediaGroupId) : null,
    albumPrimaryId: raw.albumPrimaryId != null ? Number(raw.albumPrimaryId) : null,
    replyTo: replyToRaw != null ? Number(replyToRaw) : null,
    replyToMissing: Boolean(raw.replyToMissing),
    lifecycleStatus: raw.lifecycleStatus ?? 'active',
    editedAt: raw.editedAt ?? null,
    deletedAt: raw.deletedAt ?? null,
    added: raw.added ?? raw['добавлено'] ?? new Date().toISOString(),
    aiVersion: raw.aiVersion ?? 1,
    contentHash: raw.contentHash ?? computeContentHash(post)
  };
}

function createPostRecord({
  id,
  postText = '',
  mediaInfo = null,
  replyToId = null,
  mediaGroupId = null,
  added = null,
  lifecycleStatus = 'active',
  editedAt = null,
  postOriginal = null
}) {
  const post = postText || '';
  return {
    id: Number(id),
    post,
    postOriginal,
    title: '',
    mainIdea: '',
    tags: [],
    category: '',
    keywords: [],
    media: mediaInfo || null,
    mediaGroupId: mediaGroupId ? String(mediaGroupId) : null,
    albumPrimaryId: null,
    replyTo: replyToId != null ? Number(replyToId) : null,
    replyToMissing: false,
    lifecycleStatus,
    editedAt,
    deletedAt: null,
    added: added || new Date().toISOString(),
    aiVersion: 1,
    contentHash: computeContentHash(post)
  };
}

class ExistingPosts {
  static async _read() {
    try {
      const parsed = await JsonStore.read('existing_posts', { schemaVersion: SCHEMA_VERSION, posts: [] });
      if (parsed?.posts) {
        return {
          schemaVersion: parsed.schemaVersion || SCHEMA_VERSION,
          posts: parsed.posts.map(normalizePost)
        };
      }
      return { schemaVersion: SCHEMA_VERSION, posts: [] };
    } catch (err) {
      console.error('[ExistingPosts] Read error:', err.message);
      return { schemaVersion: SCHEMA_VERSION, posts: [] };
    }
  }

  static async _write(data) {
    try {
      if (!data || !Array.isArray(data.posts)) {
        throw new Error('Invalid data structure');
      }
      await JsonStore.write('existing_posts', {
        schemaVersion: SCHEMA_VERSION,
        posts: data.posts
      });
    } catch (err) {
      console.error('[ExistingPosts] Write error:', err.message);
      throw err;
    }
  }

  static async migrateSchema() {
    try {
      let rawPosts = [];
      let currentVersion = 1;

      try {
        const parsed = await JsonStore.read('existing_posts', { schemaVersion: 1, posts: [] });
        rawPosts = parsed?.posts || [];
        currentVersion = parsed?.schemaVersion ?? 1;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return;
      }

      const hasLegacyFields = rawPosts.some(
        (p) =>
          p['тема'] !== undefined ||
          p['главнаяМысль'] !== undefined ||
          p['описание'] !== undefined ||
          p['медиа'] !== undefined ||
          p['ответНа'] !== undefined ||
          p['добавлено'] !== undefined
      );

      const needsV2 = currentVersion < SCHEMA_VERSION || hasLegacyFields ||
        rawPosts.some((p) => p.lifecycleStatus === undefined);

      const needsV3 =
        currentVersion < SCHEMA_VERSION ||
        rawPosts.some((p) => p.mediaGroupId === undefined && p.albumPrimaryId === undefined);

      if (needsV2) {
        await this._write({ posts: rawPosts.map(normalizePost) });
        console.log('[ExistingPosts] Schema migrated to v2');
      }

      if (needsV3) {
        await this.reconcileAlbumLinks();
        console.log('[ExistingPosts] Album links reconciled (schema v3)');
      } else {
        await this.reconcileAlbumLinks();
      }

      await this.cleanupEmptyPosts();
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[ExistingPosts] migrateSchema error:', err.message);
      }
    }
  }

  static async reconcileAlbumLinks() {
    const data = await this._read();
    const posts = (data.posts || []).map(normalizePost);

    for (const groupId of new Set(posts.map((p) => p.mediaGroupId).filter(Boolean))) {
      const group = posts.filter((p) => p.mediaGroupId === groupId);
      if (group.length < 2) continue;
      const primary = pickAlbumPrimary(group);
      for (const p of group) {
        p.albumPrimaryId = p.id === primary.id ? null : primary.id;
      }
    }

    const bySecond = new Map();
    for (const p of posts) {
      if (!isMediaOnly(p) && !p.mediaGroupId) continue;
      const key = Math.floor(new Date(p.added).getTime() / 1000);
      if (!bySecond.has(key)) bySecond.set(key, []);
      bySecond.get(key).push(p);
    }

    for (const group of bySecond.values()) {
      if (group.length < 2) continue;
      const mediaOnly = group.filter(isMediaOnly);
      const withContent = group.filter((p) => !isMediaOnly(p));
      if (!mediaOnly.length || !withContent.length) continue;
      const primary = pickAlbumPrimary(withContent);
      for (const p of mediaOnly) {
        if (!p.mediaGroupId) {
          p.albumPrimaryId = primary.id;
        }
      }
    }

    for (const p of posts) {
      if (isMediaOnly(p)) {
        const inferred = inferAlbumPrimaryId(p, posts);
        p.albumPrimaryId = inferred && inferred !== p.id ? inferred : null;
      } else if (p.albumPrimaryId && p.albumPrimaryId === p.id) {
        p.albumPrimaryId = null;
      }
    }

    data.posts = posts;
    await this._write(data);
  }

  static isEmptyPost(post) {
    return isEmptyPost(post);
  }

  static async cleanupEmptyPosts() {
    const data = await this._read();
    let cleaned = 0;
    for (const p of data.posts || []) {
      if (isEmptyPost(p) && p.lifecycleStatus === 'active') {
        p.lifecycleStatus = 'deleted';
        p.deletedAt = p.deletedAt || new Date().toISOString();
        cleaned++;
      }
    }
    if (cleaned) await this._write(data);
    return cleaned;
  }

  static async addPost(messageId, postText = '', mediaInfo = null, replyToId = null, mediaGroupId = null) {
    try {
      const data = await this._read();
      const id = Number(messageId);
      const existing = (data.posts || []).find((p) => p.id === id);

      if (existing) {
        console.log(`[ExistingPosts] ℹ️  Post #${id} already exists`);
        return existing;
      }

      if (!postText?.trim() && !mediaInfo) {
        console.log(`[ExistingPosts] Skip empty post #${id} (no text, no media)`);
        return null;
      }

      const post = createPostRecord({
        id,
        postText,
        mediaInfo,
        replyToId,
        mediaGroupId
      });

      data.posts = data.posts || [];
      data.posts.push(post);
      data.posts.sort((a, b) => a.id - b.id);

      await this._write(data);
      if (mediaGroupId) {
        await this.reconcileAlbumLinks();
      } else if (isMediaOnly(post)) {
        await this.reconcileAlbumLinks();
      }
      const mediaStr = mediaInfo ? `, ${mediaInfo.type} x${mediaInfo.count}` : '';
      console.log(`[ExistingPosts] ✅ Post #${id} added${mediaStr}`);
      return post;
    } catch (err) {
      console.error('[ExistingPosts] addPost error:', err.message);
      throw err;
    }
  }

  static async upsertPost(payload, options = {}) {
    const { force = false } = options;
    const data = await this._read();
    const id = Number(payload.id);
    const idx = (data.posts || []).findIndex((p) => p.id === id);

    if (idx === -1) {
      const post = createPostRecord({
        id,
        postText: payload.post ?? '',
        mediaInfo: payload.media ?? null,
        replyToId: payload.replyTo ?? null,
        mediaGroupId: payload.mediaGroupId ?? null,
        added: payload.added ?? null,
        lifecycleStatus: payload.lifecycleStatus ?? 'active',
        editedAt: payload.editedAt ?? null,
        postOriginal: payload.postOriginal ?? null
      });
      Object.assign(post, {
        title: payload.title ?? post.title,
        mainIdea: payload.mainIdea ?? post.mainIdea,
        tags: payload.tags ?? post.tags,
        category: payload.category ?? post.category,
        keywords: payload.keywords ?? post.keywords,
        replyToMissing: payload.replyToMissing ?? false,
        contentHash: computeContentHash(post.post)
      });
      data.posts.push(post);
      data.posts.sort((a, b) => a.id - b.id);
      await this._write(data);
      if (payload.mediaGroupId || isMediaOnly(post)) {
        await this.reconcileAlbumLinks();
      }
      return { post, action: 'imported' };
    }

    const existing = data.posts[idx];
    if (existing.lifecycleStatus === 'deleted' && !force) {
      return { post: existing, action: 'skipped' };
    }

    const updates = { ...payload, id };
    if (updates.post !== undefined) {
      updates.contentHash = computeContentHash(updates.post);
    }
    if (updates.replyTo != null) {
      updates.replyTo = Number(updates.replyTo);
    }

    data.posts[idx] = normalizePost({ ...existing, ...updates });
    await this._write(data);
    return { post: data.posts[idx], action: 'updated' };
  }

  static async applyEdit(messageId, postText, mediaInfo = null, editedAt = null) {
    const data = await this._read();
    const id = Number(messageId);
    const idx = (data.posts || []).findIndex((p) => p.id === id);
    const now = editedAt || new Date().toISOString();

    if (idx === -1) {
      const post = createPostRecord({
        id,
        postText,
        mediaInfo,
        lifecycleStatus: 'edited',
        editedAt: now
      });
      data.posts.push(post);
      data.posts.sort((a, b) => a.id - b.id);
      await this._write(data);
      return post;
    }

    const existing = data.posts[idx];
    const updates = {
      post: postText || '',
      media: mediaInfo ?? existing.media,
      lifecycleStatus: 'edited',
      editedAt: now,
      contentHash: computeContentHash(postText || '')
    };

    if (!existing.postOriginal && existing.post) {
      updates.postOriginal = existing.post;
    }

    data.posts[idx] = { ...existing, ...updates };
    await this._write(data);
    return data.posts[idx];
  }

  static async markDeleted(messageId, deletedAt = null) {
    const data = await this._read();
    const id = Number(messageId);
    const idx = (data.posts || []).findIndex((p) => p.id === id);

    if (idx === -1) return null;

    data.posts[idx] = {
      ...data.posts[idx],
      lifecycleStatus: 'deleted',
      deletedAt: deletedAt || new Date().toISOString()
    };
    await this._write(data);
    return data.posts[idx];
  }

  static async updatePost(messageId, updates) {
    try {
      const data = await this._read();
      const id = Number(messageId);
      const idx = (data.posts || []).findIndex((p) => p.id === id);

      if (idx === -1) {
        console.log(`[ExistingPosts] ℹ️  Post #${id} not found`);
        return null;
      }

      if (updates.post !== undefined) {
        updates.contentHash = computeContentHash(updates.post);
      }

      data.posts[idx] = normalizePost({ ...data.posts[idx], ...updates });
      await this._write(data);
      console.log(`[ExistingPosts] ✏️  Post #${id} updated`);
      return data.posts[idx];
    } catch (err) {
      console.error('[ExistingPosts] updatePost error:', err.message);
      throw err;
    }
  }

  static async removePost(messageId) {
    return this.markDeleted(messageId);
  }

  static async getAll(includeDeleted = true) {
    const data = await this._read();
    const posts = (data.posts || []).sort((a, b) => a.id - b.id);
    if (includeDeleted) return posts;
    return posts.filter((p) => p.lifecycleStatus !== 'deleted');
  }

  static async getById(messageId) {
    const data = await this._read();
    return (data.posts || []).find((p) => p.id === Number(messageId)) || null;
  }

  static async count() {
    const data = await this._read();
    return (data.posts || []).length;
  }

  static async validateReplyLinks() {
    const posts = await this.getAll();
    const ids = new Set(posts.map((p) => p.id));
    let fixed = 0;

    for (const post of posts) {
      if (post.replyTo != null && !ids.has(post.replyTo)) {
        await this.updatePost(post.id, { replyToMissing: true });
        fixed++;
      }
    }
    return fixed;
  }
}

module.exports = ExistingPosts;
