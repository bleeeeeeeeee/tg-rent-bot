const fs = require('fs').promises;
const path = require('path');
const { OPENAI_API_KEY } = require('../config');

const FILE_PATH = path.join(__dirname, '../../storage/secrets.json');

class SecretsService {
  static async _read() {
    try {
      const raw = await fs.readFile(FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed?.providers ? parsed : { providers: {} };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[SecretsService] Read error:', err.message);
      }
      return { providers: {} };
    }
  }

  static async _write(data) {
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
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

  static async seedFromEnv() {
    if (!OPENAI_API_KEY) return false;
    const existing = await this.getProviderSecret('openai');
    if (existing?.apiKey) return false;
    await this.setProviderSecret('openai', { apiKey: OPENAI_API_KEY });
    const SettingsService = require('./SettingsService');
    const active = await SettingsService.getActiveProvider();
    if (!active) {
      await SettingsService.setActiveProvider('openai');
    }
    console.log('[SecretsService] Seeded OpenAI key from .env');
    return true;
  }
}

module.exports = SecretsService;
