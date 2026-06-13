const JsonStore = require('../storage/JsonStore');
const { OPENAI_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, AI_ACTIVE_PROVIDER, OLLAMA_AUTO_ACTIVATE } = require('../config');

class SecretsService {
  static async _read() {
    try {
      const parsed = await JsonStore.read('secrets', { providers: {} });
      return parsed?.providers ? parsed : { providers: {} };
    } catch (err) {
      console.error('[SecretsService] Read error:', err.message);
      return { providers: {} };
    }
  }

  static async _write(data) {
    await JsonStore.write('secrets', data);
  }

  static maskSecret(value) {
    if (!value || typeof value !== 'string') return '—';
    if (value.length <= 8) return '****';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  static async getProviderSecret(providerId) {
    const data = await this._read();
    return data.providers[providerId] || null;
  }

  static async setProviderSecret(providerId, fields) {
    const data = await this._read();
    data.providers[providerId] = { ...(data.providers[providerId] || {}), ...fields };
    await this._write(data);
    return data.providers[providerId];
  }

  static async getSupabaseConfig() {
    const data = await this._read();
    return data.supabase || null;
  }

  static async setSupabaseConfig(fields) {
    const data = await this._read();
    data.supabase = { ...(data.supabase || {}), ...fields };
    await this._write(data);
    return data.supabase;
  }

  static async removeSupabaseConfig() {
    const data = await this._read();
    delete data.supabase;
    await this._write(data);
  }

  static async removeProviderSecret(providerId) {
    const data = await this._read();
    delete data.providers[providerId];
    await this._write(data);
  }

  static async listConfiguredProviders(checkFn) {
    const data = await this._read();
    const ids = Object.keys(data.providers);
    if (!checkFn) return ids;
    return ids.filter((id) => checkFn(data.providers[id]));
  }

  static invalidateCache() {
    /* Realtime hook; secrets read fresh each time */
  }

  static async seedFromEnv() {
    await this.seedOpenAiFromEnv();
    await this.seedOllamaFromEnv();
  }

  static async seedOpenAiFromEnv() {
    if (!OPENAI_API_KEY) return false;
    const existing = await this.getProviderSecret('openai');
    if (existing?.apiKey) return false;
    await this.setProviderSecret('openai', { apiKey: OPENAI_API_KEY });
    const SettingsService = require('./SettingsService');
    const active = await SettingsService.getActiveProvider();
    if (!active && !OLLAMA_AUTO_ACTIVATE && AI_ACTIVE_PROVIDER !== 'ollama') {
      await SettingsService.setActiveProvider('openai');
    }
    console.log('[SecretsService] Seeded OpenAI key from .env');
    return true;
  }

  static async seedOllamaFromEnv() {
    const baseUrl = OLLAMA_BASE_URL?.trim();
    if (!baseUrl) return false;

    const SettingsService = require('./SettingsService');
    const existing = await this.getProviderSecret('ollama');
    const normalized = baseUrl.replace(/\/$/, '');

    if (!existing?.baseUrl || existing.baseUrl.replace(/\/$/, '') !== normalized) {
      await this.setProviderSecret('ollama', { baseUrl: normalized });
      console.log(`[SecretsService] Ollama URL from env: ${normalized}`);
    }

    const model = OLLAMA_MODEL?.trim();
    if (model) {
      await SettingsService.setModel('ollama', model);
    }

    const shouldActivate =
      OLLAMA_AUTO_ACTIVATE || AI_ACTIVE_PROVIDER === 'ollama' || !(await SettingsService.getActiveProvider());

    if (shouldActivate) {
      await SettingsService.setActiveProvider('ollama');
      console.log('[SecretsService] Ollama set as active AI provider');
    }

    return true;
  }
}

module.exports = SecretsService;
