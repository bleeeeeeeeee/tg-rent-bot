const UserSettingsStore = require('../storage/UserSettingsStore');
const SettingsService = require('./SettingsService');
const { TIMEZONE } = require('../config');

const DEFAULT_USER = {
  general: {
    locale: 'ru',
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

class UserSettingsService {
  static async _globalDefaults() {
    const global = await SettingsService.getAll();
    return {
      general: {
        locale: global.general?.locale === 'en' ? 'en' : 'ru',
        timezone: global.general?.timezone || TIMEZONE || 'Europe/Moscow',
        chatCleanup: global.general?.chatCleanup !== false
      },
      ui: {
        useEmojis: global.ui?.useEmojis !== false,
        navStyle: global.ui?.navStyle === 'arrows' ? 'arrows' : 'text'
      }
    };
  }

  static async getForUser(userId) {
    const defaults = deepMerge(DEFAULT_USER, await this._globalDefaults());
    const stored = userId ? await UserSettingsStore.getUser(userId) : null;
    if (!stored) return defaults;
    return deepMerge(defaults, stored);
  }

  static async ensureUser(userId) {
    const existing = await UserSettingsStore.getUser(userId);
    if (existing) return this.getForUser(userId);
    const seeded = await this._globalDefaults();
    await UserSettingsStore.setUser(userId, seeded);
    return deepMerge(DEFAULT_USER, seeded);
  }

  static async patchUser(userId, patch) {
    await this.ensureUser(userId);
    const current = await this.getForUser(userId);
    const next = deepMerge(current, patch);
    await UserSettingsStore.setUser(userId, next);
    return next;
  }

  static async getLocale(userId) {
    const s = userId ? await this.getForUser(userId) : await this._globalDefaults();
    return s.general?.locale === 'en' ? 'en' : 'ru';
  }

  static async setLocale(userId, locale) {
    const val = locale === 'en' ? 'en' : 'ru';
    await this.patchUser(userId, { general: { locale: val } });
    return val;
  }

  static async getTimezone(userId) {
    const s = userId ? await this.getForUser(userId) : await this._globalDefaults();
    return s.general?.timezone || TIMEZONE || 'Europe/Moscow';
  }

  static async setTimezone(userId, tz) {
    await this.patchUser(userId, { general: { timezone: tz } });
    return tz;
  }

  static async getChatCleanup(userId) {
    const s = userId ? await this.getForUser(userId) : await this._globalDefaults();
    return s.general?.chatCleanup !== false;
  }

  static async setChatCleanup(userId, value) {
    await this.patchUser(userId, { general: { chatCleanup: Boolean(value) } });
    return Boolean(value);
  }

  static async getCleanupMessageIds(userId) {
    const s = userId ? await this.getForUser(userId) : await this._globalDefaults();
    const ids = s.general?.botMessageIds;
    return Array.isArray(ids) ? ids.filter(Boolean) : [];
  }

  static async setCleanupMessageIds(userId, ids) {
    const unique = [...new Set((ids || []).map(Number).filter(Boolean))].slice(-48);
    await this.patchUser(userId, { general: { botMessageIds: unique } });
    return unique;
  }

  static async getUiStyle(userId) {
    const s = userId ? await this.getForUser(userId) : await this._globalDefaults();
    return {
      useEmojis: s.ui?.useEmojis !== false,
      navStyle: s.ui?.navStyle === 'arrows' ? 'arrows' : 'text'
    };
  }

  static async setUiStyle(userId, patch) {
    const ui = {};
    if (patch.useEmojis !== undefined) ui.useEmojis = Boolean(patch.useEmojis);
    if (patch.navStyle !== undefined) {
      ui.navStyle = patch.navStyle === 'arrows' ? 'arrows' : 'text';
    }
    await this.patchUser(userId, { ui });
    return this.getUiStyle(userId);
  }

  static invalidateCache() {
    /* Realtime hook */
  }
}

module.exports = UserSettingsService;
