const { createClient } = require('@supabase/supabase-js');
const { COLLECTIONS } = require('./collections');

function supabaseClientOptions() {
  const options = {
    auth: { persistSession: false, autoRefreshToken: false }
  };
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) {
    options.realtime = { transport: require('ws') };
  }
  return options;
}

class SupabaseBackend {
  constructor(url, serviceKey) {
    this.name = 'supabase';
    this.url = url;
    this.client = createClient(url, serviceKey, supabaseClientOptions());
  }

  async healthCheck() {
    const { error } = await this.client.from('sync_meta').select('id').limit(1);
    if (error && !/does not exist|relation/.test(error.message)) {
      return { ok: false, backend: 'supabase', error: error.message };
    }
    return { ok: true, backend: 'supabase', url: this.url };
  }

  async read(key, defaultValue = null) {
    switch (key) {
      case 'settings':
      case 'secrets':
      case 'access':
        return this._readSingleton(key, defaultValue);
      case 'existing_posts':
        return this._readPosts(defaultValue);
      case 'processed_posts':
        return this._readProcessed(defaultValue);
      case 'drafts':
        return this._readDrafts(defaultValue);
      case 'scheduled':
        return this._readScheduled(defaultValue);
      default:
        throw new Error(`Unknown collection: ${key}`);
    }
  }

  async write(key, data) {
    switch (key) {
      case 'settings':
      case 'secrets':
      case 'access':
        await this._writeSingleton(key, data);
        break;
      case 'existing_posts':
        await this._writePosts(data);
        break;
      case 'processed_posts':
        await this._writeProcessed(data);
        break;
      case 'drafts':
        await this._writeDrafts(data);
        break;
      case 'scheduled':
        await this._writeScheduled(data);
        break;
      default:
        throw new Error(`Unknown collection: ${key}`);
    }
    await this._touchSyncMeta(key);
    return data;
  }

  async _readSingleton(key, defaultValue) {
    const table = COLLECTIONS[key].supabaseTable;
    const { data, error } = await this.client.from(table).select('payload').eq('id', 'default').maybeSingle();
    if (error) throw new Error(error.message);
    return data?.payload ?? defaultValue;
  }

  async _writeSingleton(key, payload) {
    const table = COLLECTIONS[key].supabaseTable;
    const { error } = await this.client.from(table).upsert({
      id: 'default',
      payload,
      updated_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
  }

  async _readPosts(defaultValue) {
    const { data, error } = await this.client
      .from('channel_posts')
      .select('payload')
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    if (!data?.length) return defaultValue ?? { schemaVersion: 3, posts: [] };
    const posts = data.map((r) => r.payload);
    const schemaVersion = posts[0]?.schemaVersion || 3;
    return { schemaVersion, posts };
  }

  async _writePosts(doc) {
    const posts = doc?.posts || [];
    await this.client.from('channel_posts').delete().neq('id', 0);
    if (!posts.length) return;
    const rows = posts.map((p) => ({
      id: Number(p.id),
      payload: p,
      schema_version: doc.schemaVersion || 3,
      updated_at: new Date().toISOString()
    }));
    const chunk = 200;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await this.client.from('channel_posts').upsert(rows.slice(i, i + chunk));
      if (error) throw new Error(error.message);
    }
  }

  async _readProcessed(defaultValue) {
    const { data, error } = await this.client.from('processed_entries').select('*').order('id');
    if (error) throw new Error(error.message);
    if (!data?.length) return defaultValue ?? { entries: [] };
    return {
      entries: data.map((r) => ({
        id: Number(r.id),
        contentHash: r.content_hash,
        aiVersion: r.ai_version
      }))
    };
  }

  async _writeProcessed(doc) {
    const entries = doc?.entries || [];
    await this.client.from('processed_entries').delete().neq('id', 0);
    if (!entries.length) return;
    const rows = entries.map((e) => ({
      id: Number(e.id),
      content_hash: e.contentHash ?? null,
      ai_version: e.aiVersion ?? 1,
      updated_at: new Date().toISOString()
    }));
    const { error } = await this.client.from('processed_entries').upsert(rows);
    if (error) throw new Error(error.message);
  }

  async _readDrafts(defaultValue) {
    const { data, error } = await this.client.from('drafts').select('payload');
    if (error) throw new Error(error.message);
    if (!data?.length) return defaultValue ?? { drafts: [] };
    return { drafts: data.map((r) => r.payload) };
  }

  async _writeDrafts(doc) {
    const drafts = doc?.drafts || [];
    await this.client.from('drafts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (!drafts.length) return;
    const rows = drafts.map((d) => ({
      id: d.id,
      user_id: String(d.userId),
      payload: d,
      updated_at: d.updatedAt || d.createdAt || new Date().toISOString()
    }));
    const { error } = await this.client.from('drafts').upsert(rows);
    if (error) throw new Error(error.message);
  }

  async _readScheduled(defaultValue) {
    const { data, error } = await this.client.from('scheduled_posts').select('payload');
    if (error) throw new Error(error.message);
    if (!data?.length) return defaultValue ?? { posts: [] };
    return { posts: data.map((r) => r.payload) };
  }

  async _writeScheduled(doc) {
    const posts = doc?.posts || [];
    await this.client.from('scheduled_posts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (!posts.length) return;
    const rows = posts.map((p) => ({
      id: p.id,
      payload: p,
      status: p.status || 'pending',
      publish_at: p.publishAt || null,
      updated_at: new Date().toISOString()
    }));
    const { error } = await this.client.from('scheduled_posts').upsert(rows);
    if (error) throw new Error(error.message);
  }

  async getSyncMeta() {
    const { data, error } = await this.client.from('sync_meta').select('*').eq('id', 'default').maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  async setSyncMeta(patch) {
    const current = (await this.getSyncMeta()) || { id: 'default' };
    const row = { ...current, ...patch, id: 'default', updated_at: new Date().toISOString() };
    const { error } = await this.client.from('sync_meta').upsert(row);
    if (error) throw new Error(error.message);
    return row;
  }

  async _touchSyncMeta(collectionKey) {
    try {
      const meta = (await this.getSyncMeta()) || {};
      const counts = meta.record_counts || {};
      counts[collectionKey] = (counts[collectionKey] || 0) + 1;
      await this.setSyncMeta({ last_push: new Date().toISOString(), record_counts: counts });
    } catch {
      /* sync_meta optional during setup */
    }
  }

  getClient() {
    return this.client;
  }
}

module.exports = SupabaseBackend;
