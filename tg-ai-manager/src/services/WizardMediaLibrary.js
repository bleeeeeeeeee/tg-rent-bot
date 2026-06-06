const { v4: uuidv4 } = require('uuid');
const {
  MEDIA_GROUP_MAX,
  validateMediaCollection
} = require('../utils/telegramMedia');

const POOL_MAX = 100;
const GALLERY_PAGE_SIZE = 8;

function ensurePool(wizard) {
  if (!wizard.mediaPool) wizard.mediaPool = [];
  if (!wizard.selectedMediaIds) wizard.selectedMediaIds = [];
}

function poolItems(wizard, ids) {
  const pool = wizard.mediaPool || [];
  return (ids || [])
    .map((id) => pool.find((p) => p.id === id))
    .filter(Boolean);
}

function syncStaged(wizard) {
  ensurePool(wizard);
  wizard.stagedMedia = poolItems(wizard, wizard.selectedMediaIds).map((p) => ({
    messageId: p.messageId || 0,
    chatId: p.chatId || 0,
    type: p.type,
    fileId: p.fileId,
    media: p.media,
    poolId: p.id
  }));
}

function autoSelect(wizard) {
  ensurePool(wizard);
  const selected = [];
  for (const item of wizard.mediaPool) {
    const trial = [...selected, item.id];
    const trialItems = poolItems(wizard, trial);
    const check = validateMediaCollection(
      trialItems.map((i) => ({ type: i.type, fileId: i.fileId, media: i.media }))
    );
    if (check.ok && trialItems.length <= MEDIA_GROUP_MAX) {
      selected.push(item.id);
    }
  }
  wizard.selectedMediaIds = selected;
  syncStaged(wizard);
}

function addToPool(wizard, items) {
  ensurePool(wizard);
  const added = [];
  let skipped = 0;

  for (const item of items) {
    if (wizard.mediaPool.length >= POOL_MAX) {
      skipped += 1;
      continue;
    }
    const entry = {
      id: uuidv4().slice(0, 8),
      type: item.type,
      fileId: item.fileId,
      media: item.media,
      messageId: 0,
      chatId: 0,
      addedAt: Date.now()
    };
    wizard.mediaPool.push(entry);
    added.push(entry);
  }

  autoSelect(wizard);
  return { added, skipped, poolTotal: wizard.mediaPool.length, selected: wizard.selectedMediaIds.length };
}

function toggleSelect(wizard, id) {
  ensurePool(wizard);
  if (!wizard.mediaPool.some((p) => p.id === id)) {
    return { ok: false, error: 'Файл не найден.' };
  }

  const idx = wizard.selectedMediaIds.indexOf(id);
  if (idx >= 0) {
    wizard.selectedMediaIds.splice(idx, 1);
    syncStaged(wizard);
    return { ok: true };
  }

  const trialIds = [...wizard.selectedMediaIds, id];
  const trialItems = poolItems(wizard, trialIds);
  if (trialItems.length > MEDIA_GROUP_MAX) {
    return {
      ok: false,
      error: `В пост можно выбрать не более ${MEDIA_GROUP_MAX} файлов (лимит Telegram). Снимите выбор с других.`
    };
  }
  const check = validateMediaCollection(
    trialItems.map((i) => ({ type: i.type, fileId: i.fileId, media: i.media }))
  );
  if (!check.ok) return check;

  wizard.selectedMediaIds.push(id);
  syncStaged(wizard);
  return { ok: true };
}

function removeFromPool(wizard, id) {
  ensurePool(wizard);
  wizard.mediaPool = wizard.mediaPool.filter((p) => p.id !== id);
  wizard.selectedMediaIds = wizard.selectedMediaIds.filter((i) => i !== id);
  syncStaged(wizard);
}

function clearPool(wizard) {
  wizard.mediaPool = [];
  wizard.selectedMediaIds = [];
  wizard.stagedMedia = [];
}

function applyRestagedMessages(wizard, stagedItems) {
  ensurePool(wizard);
  for (const item of stagedItems) {
    const poolItem = wizard.mediaPool.find((p) => p.id === item.poolId);
    if (poolItem) {
      poolItem.messageId = item.messageId;
      poolItem.chatId = item.chatId;
    }
  }
  syncStaged(wizard);
}

function formatItemLabel(item, index, selected) {
  const typeLabels = {
    photo: 'фото',
    video: 'видео',
    animation: 'GIF',
    document: 'док.',
    audio: 'аудио',
    voice: 'голос',
    video_note: 'кружок'
  };
  const mark = selected ? '✓' : '·';
  return `${mark} ${index}. ${typeLabels[item.type] || item.type}`;
}

function formatPoolSummary(wizard, { forPre = false } = {}) {
  ensurePool(wizard);
  if (!wizard.mediaPool.length) return forPre ? '(пусто)' : 'нет файлов';

  const lines = wizard.mediaPool.map((item, i) => {
    const selected = wizard.selectedMediaIds.includes(item.id);
    return formatItemLabel(item, i + 1, selected);
  });

  const header = `Библиотека: ${wizard.mediaPool.length} · в посте: ${wizard.selectedMediaIds.length}/${MEDIA_GROUP_MAX}`;
  return forPre ? `${header}\n${lines.join('\n')}` : `${header}\n${lines.join(', ')}`;
}

function getGalleryPage(wizard, page = 0) {
  ensurePool(wizard);
  const total = wizard.mediaPool.length;
  const pageSize = GALLERY_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const start = safePage * pageSize;
  const items = wizard.mediaPool.slice(start, start + pageSize);
  return { page: safePage, pageCount, items, start, total };
}

function migrateLegacyMedia(wizard) {
  if (wizard.mediaPool?.length) return;
  if (!wizard.stagedMedia?.length) return;
  ensurePool(wizard);
  for (const item of wizard.stagedMedia) {
    if (!item.fileId) continue;
    wizard.mediaPool.push({
      id: uuidv4().slice(0, 8),
      type: item.type,
      fileId: item.fileId,
      media: item.media,
      messageId: item.messageId || 0,
      chatId: item.chatId || 0,
      addedAt: Date.now()
    });
  }
  autoSelect(wizard);
}

module.exports = {
  POOL_MAX,
  GALLERY_PAGE_SIZE,
  MEDIA_GROUP_MAX,
  ensurePool,
  syncStaged,
  autoSelect,
  addToPool,
  toggleSelect,
  removeFromPool,
  clearPool,
  applyRestagedMessages,
  formatPoolSummary,
  formatItemLabel,
  getGalleryPage,
  migrateLegacyMedia
};
