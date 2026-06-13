const StorageRegistry = require('./StorageRegistry');

const EMPTY_DOC = () => ({ users: {} });

class UserSettingsStore {
  static async _readFileMap(backend) {
    const file = backend.name === 'dual' ? backend.file : backend;
    return (await file.read('user_settings', null)) || EMPTY_DOC();
  }

  static async _writeFileMap(backend, doc) {
    const file = backend.name === 'dual' ? backend.file : backend;
    await file.write('user_settings', doc);
  }

  static _cloudClient(backend) {
    if (backend.name === 'supabase') return backend;
    if (backend.name === 'dual') return backend.getSupabase();
    return null;
  }

  static async getUser(userId) {
    const id = String(userId);
    const backend = StorageRegistry.getBackend();

    const cloud = this._cloudClient(backend);
    if (cloud) {
      try {
        const row = await cloud.getUserSettings(id);
        if (row) return row;
      } catch (err) {
        if (!/does not exist|relation|user_settings/.test(err.message)) {
          console.warn('[UserSettingsStore] cloud read:', err.message);
        }
      }
    }

    const map = await this._readFileMap(backend.name === 'supabase' ? StorageRegistry.getFileBackend() : backend);
    return map.users?.[id] || null;
  }

  static async setUser(userId, payload) {
    const id = String(userId);
    const backend = StorageRegistry.getBackend();
    const now = new Date().toISOString();
    const record = { ...payload, updatedAt: now };

    if (backend.name === 'file') {
      const map = await this._readFileMap(backend);
      map.users = map.users || {};
      map.users[id] = record;
      await this._writeFileMap(backend, map);
      return record;
    }

    if (backend.name === 'supabase') {
      await backend.upsertUserSettings(id, record);
      return record;
    }

    if (backend.name === 'dual') {
      const map = await this._readFileMap(backend);
      map.users = map.users || {};
      map.users[id] = record;
      await this._writeFileMap(backend, map);
      await backend.getSupabase().upsertUserSettings(id, record);
      return record;
    }

    throw new Error(`Unsupported backend: ${backend.name}`);
  }
}

module.exports = UserSettingsStore;
