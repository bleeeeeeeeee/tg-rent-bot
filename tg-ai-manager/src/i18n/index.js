const ru = require('./ru');
const en = require('./en');

const PACKS = { ru, en };

function interpolate(text, params = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

function t(key, params, locale = 'ru') {
  const pack = PACKS[locale === 'en' ? 'en' : 'ru'] || ru;
  const fallback = PACKS.ru[key];
  const text = pack[key] ?? fallback ?? key;
  return params ? interpolate(text, params) : text;
}

async function getLocale() {
  try {
    const SettingsService = require('../services/SettingsService');
    return (await SettingsService.getLocale()) === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

async function tAsync(key, params) {
  return t(key, params, await getLocale());
}

module.exports = { t, tAsync, getLocale, interpolate };
