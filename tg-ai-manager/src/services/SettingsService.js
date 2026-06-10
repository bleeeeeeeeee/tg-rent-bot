const JsonStore = require('../storage/JsonStore');
const { TIMEZONE } = require('../config');

const DEFAULT_SETTINGS = {
  ai: {
    activeProvider: null,
    autoEnrich: true,
    customProviders: [],
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
    chatCleanup: true,
    locale: 'ru'
  },
  ui: {
    useEmojis: true,
    navStyle: 'text'
  },
  cloud: {
    mode: 'file',
    supabaseUrl: '',
    instanceLabel: '',
    lastSyncAt: null,
    lastSyncError: null
  },
  access: {
    masterPasswordSet: false,
    guest: {
      draftsEdit: false
    }
  },
  topics: {
    history: []
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
      const raw = await JsonStore.read('settings', {});
      return deepMerge(DEFAULT_SETTINGS, raw);
    } catch (err) {
      console.error('[SettingsService] Read error:', err.message);
      return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
  }

  static async _write(data) {
    await JsonStore.write('settings', data);
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

  static async getCloud() {
    const s = await this._read();
    return {
      mode: s.cloud?.mode || 'file',
      supabaseUrl: s.cloud?.supabaseUrl || '',
      instanceLabel: s.cloud?.instanceLabel || '',
      lastSyncAt: s.cloud?.lastSyncAt || null,
      lastSyncError: s.cloud?.lastSyncError || null
    };
  }

  static async setCloud(patch) {
    const s = await this._read();
    s.cloud = { ...(s.cloud || {}), ...patch };
    await this._write(s);
    return this.getCloud();
  }

  static async getLocale() {
    const s = await this._read();
    return s.general?.locale === 'en' ? 'en' : 'ru';
  }

  static async setLocale(locale) {
    const s = await this._read();
    s.general = s.general || {};
    s.general.locale = locale === 'en' ? 'en' : 'ru';
    await this._write(s);
    return s.general.locale;
  }

  static async getCustomProviders() {
    const s = await this._read();
    return Array.isArray(s.ai?.customProviders) ? s.ai.customProviders : [];
  }

  static slugifyLabel(label) {
    const base = String(label || 'api')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32) || 'api';
    return `custom_${base}`;
  }

  static async addCustomProvider({ label, baseUrl, defaultModel, requiresKey = true }) {
    const s = await this._read();
    s.ai = s.ai || {};
    s.ai.customProviders = s.ai.customProviders || [];
    let id = this.slugifyLabel(label);
    const existing = new Set(s.ai.customProviders.map((p) => p.id));
    let n = 1;
    while (existing.has(id)) {
      id = `${this.slugifyLabel(label)}_${n++}`;
    }
    const row = {
      id,
      label: String(label).trim(),
      baseUrl: String(baseUrl).trim(),
      defaultModel: String(defaultModel).trim(),
      requiresKey: requiresKey !== false,
      createdAt: new Date().toISOString()
    };
    s.ai.customProviders.push(row);
    s.ai.models = s.ai.models || {};
    s.ai.models[id] = row.defaultModel;
    await this._write(s);
    return row;
  }

  static async removeCustomProvider(providerId) {
    const s = await this._read();
    s.ai.customProviders = (s.ai.customProviders || []).filter((p) => p.id !== providerId);
    if (s.ai.models?.[providerId]) delete s.ai.models[providerId];
    if (s.ai.activeProvider === providerId) s.ai.activeProvider = null;
    await this._write(s);
  }

  static async getCustomProvider(providerId) {
    return (await this.getCustomProviders()).find((p) => p.id === providerId) || null;
  }

  static async updateCustomProvider(providerId, patch) {
    const s = await this._read();
    const list = s.ai?.customProviders || [];
    const idx = list.findIndex((p) => p.id === providerId);
    if (idx < 0) throw new Error('Custom provider not found');
    list[idx] = {
      ...list[idx],
      ...patch,
      id: providerId,
      updatedAt: new Date().toISOString()
    };
    s.ai.customProviders = list;
    if (patch.defaultModel) {
      s.ai.models = s.ai.models || {};
      s.ai.models[providerId] = patch.defaultModel;
    }
    await this._write(s);
    return list[idx];
  }

  static async getGuestPermissions() {
    const s = await this._read();
    return {
      draftsEdit: s.access?.guest?.draftsEdit === true
    };
  }

  static async setGuestPermissions(patch) {
    const s = await this._read();
    s.access = s.access || {};
    s.access.guest = { ...(s.access.guest || {}), ...patch };
    await this._write(s);
    return this.getGuestPermissions();
  }

  static invalidateCache() {
    /* hook for Realtime; settings read fresh each time */
  }

  static async getTopicHistory() {
    const s = await this._read();
    return Array.isArray(s.topics?.history) ? s.topics.history : [];
  }

  static async setTopicHistory(history) {
    const s = await this._read();
    s.topics = s.topics || {};
    s.topics.history = history;
    await this._write(s);
    return s.topics.history;
  }
}

module.exports = SettingsService;
