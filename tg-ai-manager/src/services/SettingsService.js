const fs = require('fs').promises;
const path = require('path');
const { TIMEZONE } = require('../config');

const FILE_PATH = path.join(__dirname, '../../storage/settings.json');

const DEFAULT_SETTINGS = {
  ai: {
    activeProvider: null,
    autoEnrich: true,
    models: {
      openai: 'gpt-4o-mini',
      gemini: 'gemini-2.0-flash',
      groq: 'llama-3.3-70b-versatile',
      openrouter: 'meta-llama/llama-3.2-3b-instruct:free',
      ollama: 'llama3.2',
      deepseek: 'deepseek-chat',
      mistral: 'mistral-small-latest'
    }
  },
  general: {
    timezone: TIMEZONE || 'Europe/Moscow',
    chatCleanup: true
  },
  ui: {
    useEmojis: true,
    navStyle: 'text'
  }
};

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides || {})) {
    if (
      overrides[key] &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      defaults[key]
    ) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else if (overrides[key] !== undefined) {
      result[key] = overrides[key];
    }
  }
  return result;
}

class SettingsService {
  static async _read() {
    try {
      const raw = await fs.readFile(FILE_PATH, 'utf8');
      return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[SettingsService] Read error:', err.message);
      }
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  static async _write(data) {
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  static async getAll() {
    return this._read();
  }

  static async getActiveProvider() {
    const s = await this._read();
    return s.ai.activeProvider || null;
  }

  static async setActiveProvider(providerId) {
    const s = await this._read();
    s.ai.activeProvider = providerId;
    await this._write(s);
    return s.ai.activeProvider;
  }

  static async getAutoEnrich() {
    const s = await this._read();
    return s.ai.autoEnrich !== false;
  }

  static async setAutoEnrich(value) {
    const s = await this._read();
    s.ai.autoEnrich = Boolean(value);
    await this._write(s);
    return s.ai.autoEnrich;
  }

  static async getTimezone() {
    const s = await this._read();
    return s.general?.timezone || TIMEZONE || 'Europe/Moscow';
  }

  static async setTimezone(tz) {
    const s = await this._read();
    s.general = s.general || {};
    s.general.timezone = tz;
    await this._write(s);
    return tz;
  }

  static async getChatCleanup() {
    const s = await this._read();
    return s.general?.chatCleanup !== false;
  }

  static async setChatCleanup(value) {
    const s = await this._read();
    s.general = s.general || {};
    s.general.chatCleanup = Boolean(value);
    await this._write(s);
    return s.general.chatCleanup;
  }

  static async getUiStyle() {
    const s = await this._read();
    return {
      useEmojis: s.ui?.useEmojis !== false,
      navStyle: s.ui?.navStyle === 'arrows' ? 'arrows' : 'text'
    };
  }

  static async setUiStyle(patch) {
    const s = await this._read();
    s.ui = s.ui || {};
    if (patch.useEmojis !== undefined) s.ui.useEmojis = Boolean(patch.useEmojis);
    if (patch.navStyle !== undefined) {
      s.ui.navStyle = patch.navStyle === 'arrows' ? 'arrows' : 'text';
    }
    await this._write(s);
    return this.getUiStyle();
  }

  static resolveModel(providerId, storedModel) {
    const defaults = DEFAULT_SETTINGS.ai.models;
    const deprecated = {
      openrouter: new Set(['google/gemma-2-9b-it:free'])
    };
    if (storedModel && !deprecated[providerId]?.has(storedModel)) return storedModel;
    return defaults[providerId] || storedModel || null;
  }

  static async getModel(providerId) {
    const s = await this._read();
    const stored = s.ai.models?.[providerId] || null;
    const resolved = this.resolveModel(providerId, stored);
    if (resolved && resolved !== stored) {
      s.ai.models = s.ai.models || {};
      s.ai.models[providerId] = resolved;
      await this._write(s);
    }
    return resolved;
  }

  static async setModel(providerId, model) {
    const s = await this._read();
    s.ai.models = s.ai.models || {};
    s.ai.models[providerId] = model;
    await this._write(s);
    return model;
  }
}

module.exports = SettingsService;
