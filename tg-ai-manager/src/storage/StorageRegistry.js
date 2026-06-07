const FileBackend = require('./FileBackend');
const SupabaseBackend = require('./SupabaseBackend');

class DualSyncBackend {
  constructor(fileBackend, supabaseBackend) {
    this.name = 'dual';
    this.file = fileBackend;
    this.cloud = supabaseBackend;
  }

  async read(key, defaultValue = null) {
    return this.file.read(key, defaultValue);
  }

  async write(key, data) {
    await this.file.write(key, data);
    try {
      await this.cloud.write(key, data);
    } catch (err) {
      console.error(`[DualSyncBackend] cloud write failed for ${key}:`, err.message);
      throw err;
    }
    return data;
  }

  async healthCheck() {
    const local = await this.file.healthCheck();
    const remote = await this.cloud.healthCheck();
    return { ok: local.ok && remote.ok, local, remote, backend: 'dual' };
  }

  async pushAll() {
    const keys = Object.keys(require('./collections').COLLECTIONS);
    const counts = {};
    for (const key of keys) {
      const data = await this.file.read(key, null);
      if (data != null) {
        await this.cloud.write(key, data);
        counts[key] = Array.isArray(data.posts)
          ? data.posts.length
          : Array.isArray(data.drafts)
            ? data.drafts.length
            : Array.isArray(data.entries)
              ? data.entries.length
              : 1;
      }
    }
    await this.cloud.setSyncMeta({
      last_push: new Date().toISOString(),
      record_counts: counts
    });
    return counts;
  }

  async pullAll() {
    const keys = Object.keys(require('./collections').COLLECTIONS);
    const counts = {};
    for (const key of keys) {
      const remote = await this.cloud.read(key, null);
      if (remote != null) {
        await this.file.write(key, remote);
        counts[key] = Array.isArray(remote.posts)
          ? remote.posts.length
          : Array.isArray(remote.drafts)
            ? remote.drafts.length
            : Array.isArray(remote.entries)
              ? remote.entries.length
              : 1;
      }
    }
    await this.cloud.setSyncMeta({ last_pull: new Date().toISOString() });
    return counts;
  }

  async exportAll() {
    return this.file.exportAll();
  }

  getSupabase() {
    return this.cloud;
  }
}

class StorageRegistry {
  static _backend = null;
  static _fileBackend = new FileBackend();

  static getFileBackend() {
    return this._fileBackend;
  }

  static resolveBackend(config = null, options = {}) {
    const cfg = config || require('../config');
    const mode = options.mode || cfg.STORAGE_BACKEND || 'file';

    if (mode === 'file') {
      return this._fileBackend;
    }

    const url = cfg.SUPABASE_URL;
    const key = cfg.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required for cloud storage');
    }

    const supabase = new SupabaseBackend(url, key);

    if (mode === 'supabase') {
      return supabase;
    }

    if (mode === 'dual') {
      return new DualSyncBackend(this._fileBackend, supabase);
    }

    return this._fileBackend;
  }

  static getBackend() {
    if (!this._backend) {
      this._backend = this.resolveBackend();
    }
    return this._backend;
  }

  static reset() {
    this._backend = null;
  }

  static useBackend(backend) {
    this._backend = backend;
  }

  static async reconfigure(mode) {
    const SecretsService = require('../services/SecretsService');
    const secrets = await SecretsService.getSupabaseConfig();
    const cfg = {
      ...require('../config'),
      STORAGE_BACKEND: mode,
      SUPABASE_URL: require('../config').SUPABASE_URL || secrets?.url || '',
      SUPABASE_SERVICE_KEY: require('../config').SUPABASE_SERVICE_KEY || secrets?.serviceKey || ''
    };
    this.reset();
    this.useBackend(this.resolveBackend(cfg, { mode }));
    return this.getBackend();
  }
}

module.exports = StorageRegistry;
