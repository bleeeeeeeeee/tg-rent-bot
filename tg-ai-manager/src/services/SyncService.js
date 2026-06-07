const fs = require('fs/promises');
const path = require('path');
const StorageRegistry = require('../storage/StorageRegistry');
const SupabaseBackend = require('../storage/SupabaseBackend');
const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const { COLLECTIONS } = require('../storage/collections');
const { STORAGE_BACKEND, SUPABASE_URL, SUPABASE_SERVICE_KEY, INSTANCE_ID } = require('../config');

class SyncService {
  static _realtimeChannel = null;
  static _status = {
    connected: false,
    lastEventAt: null,
    lastError: null,
    instanceId: INSTANCE_ID
  };

  static async init() {
    await this._registerInstance();
    this.startHeartbeat();
    await this.startRealtime();
  }

  static getStatus() {
    return { ...this._status };
  }

  static async getPushConflictWarning() {
    try {
      const cloud = await SettingsService.getCloud();
      const meta = await this.getCloudMeta();
      if (!meta?.last_push) return null;
      const lastLocal = cloud.lastSyncAt ? new Date(cloud.lastSyncAt).getTime() : 0;
      const lastRemote = new Date(meta.last_push).getTime();
      if (lastRemote > lastLocal + 5000) {
        return { time: meta.last_push, instanceId: meta.instance_id || null };
      }
      return null;
    } catch {
      return null;
    }
  }

  static async resolveSupabaseCredentials() {
    const secrets = await SecretsService.getSupabaseConfig();
    return {
      url: SUPABASE_URL || secrets?.url || '',
      key: SUPABASE_SERVICE_KEY || secrets?.serviceKey || ''
    };
  }

  static async createCloudBackend() {
    const { url, key } = await this.resolveSupabaseCredentials();
    if (!url || !key) {
      throw new Error('Укажите SUPABASE_URL и SUPABASE_SERVICE_KEY в .env или в настройках облака');
    }
    return new SupabaseBackend(url, key);
  }

  static async testConnection() {
    try {
      const backend = await this.createCloudBackend();
      const result = await backend.healthCheck();
      if (!result.ok) {
        await SettingsService.setCloud({ lastSyncError: result.error || 'connection failed' });
        return result;
      }
      await SettingsService.setCloud({ lastSyncError: null });
      return result;
    } catch (err) {
      await SettingsService.setCloud({ lastSyncError: err.message });
      return { ok: false, error: err.message };
    }
  }

  static _countRecords(data) {
    if (!data) return 0;
    if (Array.isArray(data.posts)) return data.posts.length;
    if (Array.isArray(data.drafts)) return data.drafts.length;
    if (Array.isArray(data.entries)) return data.entries.length;
    return 1;
  }

  static async migrateToCloud() {
    const cloud = await this.createCloudBackend();
    const file = StorageRegistry.getFileBackend();
    const counts = {};
    const errors = [];

    for (const key of Object.keys(COLLECTIONS)) {
      try {
        const data = await file.read(key, null);
        if (data != null) {
          await cloud.write(key, data);
          counts[key] = this._countRecords(data);
        }
      } catch (err) {
        errors.push(`${key}: ${err.message}`);
      }
    }

    await cloud.setSyncMeta({
      instance_id: INSTANCE_ID,
      last_push: new Date().toISOString(),
      record_counts: counts,
      last_error: errors.length ? errors.join('; ') : null
    });

    await SettingsService.setCloud({
      lastSyncAt: new Date().toISOString(),
      lastSyncError: errors.length ? errors.join('; ') : null
    });

    return { counts, errors };
  }

  static async syncNow(direction = 'push') {
    const backend = StorageRegistry.getBackend();
    const now = new Date().toISOString();

    try {
      if (backend.name === 'dual') {
        const counts = direction === 'pull' ? await backend.pullAll() : await backend.pushAll();
        await SettingsService.setCloud({ lastSyncAt: now, lastSyncError: null });
        return { ok: true, direction, counts };
      }

      if (backend.name === 'file' && direction === 'push') {
        const result = await this.migrateToCloud();
        return {
          ok: result.errors.length === 0,
          direction: 'push',
          counts: result.counts,
          errors: result.errors
        };
      }

      if (backend.name === 'supabase' && direction === 'pull') {
        const file = StorageRegistry.getFileBackend();
        const cloud = backend;
        const counts = {};
        for (const key of Object.keys(COLLECTIONS)) {
          const remote = await cloud.read(key, null);
          if (remote != null) {
            await file.write(key, remote);
            counts[key] = this._countRecords(remote);
          }
        }
        await SettingsService.setCloud({ lastSyncAt: now, lastSyncError: null });
        return { ok: true, direction: 'pull', counts };
      }

      return { ok: true, direction, counts: {}, note: 'nothing to sync for current backend' };
    } catch (err) {
      await SettingsService.setCloud({ lastSyncError: err.message });
      throw err;
    }
  }

  static async exportBackupJson() {
    const data = await StorageRegistry.getFileBackend().exportAll();
    return JSON.stringify(data, null, 2);
  }

  static async applyStorageMode(mode) {
    await SettingsService.setCloud({ mode });
    StorageRegistry.reset();
    const { url, key } = await this.resolveSupabaseCredentials();
    const cfg = {
      STORAGE_BACKEND: mode,
      SUPABASE_URL: url,
      SUPABASE_SERVICE_KEY: key
    };
    StorageRegistry.useBackend(StorageRegistry.resolveBackend(cfg));
    await this.startRealtime();
  }

  static async getCloudMeta() {
    try {
      const backend = StorageRegistry.getBackend();
      if (backend.name === 'supabase') return backend.getSyncMeta();
      if (backend.name === 'dual') return backend.getSupabase().getSyncMeta();
      const cloud = await this.createCloudBackend();
      return cloud.getSyncMeta();
    } catch {
      return null;
    }
  }

  static async _registerInstance() {
    try {
      const cloud = await this.createCloudBackend();
      const meta = (await cloud.getSyncMeta()) || {};
      if (meta.instance_id && meta.instance_id !== INSTANCE_ID && meta.updated_at) {
        const age = Date.now() - new Date(meta.updated_at).getTime();
        if (age < 120_000) {
          console.warn(
            `[SyncService] Another instance (${meta.instance_id}) was active recently. Only one bot should poll with the same token.`
          );
        }
      }
      await cloud.setSyncMeta({ instance_id: INSTANCE_ID, last_error: null });
    } catch (err) {
      console.warn('[SyncService] Instance registration skipped:', err.message);
    }
  }

  static startHeartbeat() {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => {
      this._registerInstance().catch(() => {});
    }, 60_000);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  static async startRealtime() {
    if (this._realtimeChannel) {
      try {
        await this._realtimeChannel.unsubscribe();
      } catch {
        /* ignore */
      }
      this._realtimeChannel = null;
    }

    const backend = StorageRegistry.getBackend();
    let client = null;
    if (backend.name === 'supabase') client = backend.getClient();
    if (backend.name === 'dual') client = backend.getSupabase().getClient();

    if (!client) {
      this._status.connected = false;
      return;
    }

    const tables = [
      'app_settings',
      'channel_posts',
      'drafts',
      'scheduled_posts',
      'processed_entries',
      'sync_meta'
    ];

    this._realtimeChannel = client
      .channel(`tg-ai-manager-${INSTANCE_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        (payload) => this._onRealtimeEvent('app_settings', payload)
      );

    for (const table of tables.slice(1)) {
      this._realtimeChannel = this._realtimeChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => this._onRealtimeEvent(table, payload)
      );
    }

    this._realtimeChannel.subscribe((status) => {
      this._status.connected = status === 'SUBSCRIBED';
      if (status === 'CHANNEL_ERROR') {
        this._status.lastError = 'Realtime channel error';
      }
    });
  }

  static _onRealtimeEvent(table, payload) {
    this._status.lastEventAt = new Date().toISOString();
    console.log(`[SyncService] Realtime ${payload.eventType} on ${table}`);
    if (table === 'app_settings') {
      SettingsService.invalidateCache?.();
    }
  }

  static async saveBackupToFile(userId, bot) {
    const json = await this.exportBackupJson();
    const filePath = path.join(__dirname, '../../storage', `backup-${Date.now()}.json`);
    await fs.writeFile(filePath, json, 'utf8');
    return bot.sendDocument(userId, filePath, { caption: 'Backup JSON (все коллекции)' }).finally(() =>
      fs.unlink(filePath).catch(() => {})
    );
  }
}

module.exports = SyncService;
