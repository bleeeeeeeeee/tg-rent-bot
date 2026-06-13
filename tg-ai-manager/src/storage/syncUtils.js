const { COLLECTIONS } = require('./collections');

const CRITICAL_KEYS = new Set(['settings', 'secrets', 'access']);

function countCollection(key, data) {
  if (!data) return 0;
  if (key === 'secrets') return Object.keys(data.providers || {}).length;
  if (key === 'settings') {
    let n = 0;
    if (data.ai?.activeProvider) n++;
    if (Array.isArray(data.ai?.customProviders)) n += data.ai.customProviders.length;
    return n;
  }
  if (key === 'access') {
    let n = 0;
    if (data.masterPasswordHash) n++;
    if (Array.isArray(data.sessions)) n += data.sessions.length;
    return n;
  }
  if (Array.isArray(data.posts)) return data.posts.length;
  if (Array.isArray(data.drafts)) return data.drafts.length;
  if (Array.isArray(data.entries)) return data.entries.length;
  return data ? 1 : 0;
}

function isCollectionEmpty(key, data) {
  return countCollection(key, data) === 0;
}

function shouldHydrateKey(key) {
  return CRITICAL_KEYS.has(key);
}

function collectionLabel(key, locale = 'ru') {
  const labels = {
    ru: {
      settings: 'настройки (ИИ, часовой пояс)',
      secrets: 'ключи API и Supabase',
      access: 'доступ и пароли',
      existing_posts: 'архив постов',
      processed_posts: 'обработанные посты',
      drafts: 'черновики',
      scheduled: 'очередь публикаций'
    },
    en: {
      settings: 'settings (AI, timezone)',
      secrets: 'API and Supabase keys',
      access: 'access and passwords',
      existing_posts: 'post archive',
      processed_posts: 'processed posts',
      drafts: 'drafts',
      scheduled: 'scheduled posts'
    }
  };
  const map = labels[locale] || labels.ru;
  return map[key] || key;
}

function allCollectionKeys() {
  return Object.keys(COLLECTIONS);
}

module.exports = {
  CRITICAL_KEYS,
  countCollection,
  isCollectionEmpty,
  shouldHydrateKey,
  collectionLabel,
  allCollectionKeys
};
