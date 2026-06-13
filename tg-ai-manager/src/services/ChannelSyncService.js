const { CHANNEL_ID, TG_API_ID, TG_API_HASH, TG_SESSION } = require('../config');
const ExistingPosts = require('./ExistingPosts');
const { gramMessageToPostPayload, shouldImportGramMessage } = require('../utils/gramMessage');

let syncPromise = null;

function canSync() {
  return Boolean(CHANNEL_ID && TG_API_ID && TG_API_HASH && TG_SESSION);
}

async function _iterChannelMessages(client, entity, { limit = 0 } = {}) {
  const iterOpts = {};
  if (limit > 0) iterOpts.limit = limit;

  const messages = [];
  for await (const message of client.iterMessages(entity, iterOpts)) {
    if (!shouldImportGramMessage(message)) continue;
    messages.push(message);
  }
  return messages;
}

async function syncChannel({
  limit = 0,
  markDeleted = true,
  syncText = true,
  dryRun = false,
  batchSize = 100
} = {}) {
  if (!canSync()) {
    throw new Error(
      'Нужны CHANNEL_ID, TG_API_ID, TG_API_HASH и TG_SESSION. Сессия: npm run gram:login'
    );
  }

  if (syncPromise) {
    return syncPromise;
  }

  syncPromise = _runSync({ limit, markDeleted, syncText, dryRun, batchSize }).finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

async function _runSync({ limit, markDeleted, syncText, dryRun, batchSize }) {
  const { createGramClient } = require('../lib/gramClient');
  await ExistingPosts.migrateSchema();

  const archiveBefore = await ExistingPosts.getAll();
  const client = await createGramClient();

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;
  let channelScanned = 0;

  try {
    const entity = await client.getEntity(CHANNEL_ID);
    const channelMessages = await _iterChannelMessages(client, entity, { limit });
    channelScanned = channelMessages.length;
    const channelIds = new Set(channelMessages.map((m) => m.id));

    for (const message of channelMessages) {
      const payload = gramMessageToPostPayload(message);
      if (dryRun) continue;

      const existing = archiveBefore.find((p) => p.id === payload.id);
      if (!existing) {
        const result = await ExistingPosts.upsertPost(payload, { force: true });
        if (result.action === 'imported') imported++;
        else if (result.action === 'updated') updated++;
        else skipped++;
        continue;
      }

      if (syncText) {
        const textChanged = (existing.post || '') !== (payload.post || '');
        const mediaChanged = JSON.stringify(existing.media || null) !== JSON.stringify(payload.media || null);
        const editChanged = Boolean(payload.editedAt) && existing.editedAt !== payload.editedAt;
        if (textChanged || mediaChanged || editChanged) {
          const result = await ExistingPosts.upsertPost(
            {
              ...payload,
              lifecycleStatus: payload.editedAt ? 'edited' : existing.lifecycleStatus
            },
            { force: true }
          );
          if (result.action === 'updated') updated++;
          else skipped++;
        } else {
          skipped++;
        }
      } else {
        skipped++;
      }
    }

    const fullScan = limit === 0;
    if (markDeleted && !dryRun && fullScan) {
      const localActive = (await ExistingPosts.getAll()).filter((p) => p.lifecycleStatus !== 'deleted');
      for (let i = 0; i < localActive.length; i += batchSize) {
        const batch = localActive.slice(i, i + batchSize);
        for (const post of batch) {
          if (!channelIds.has(post.id)) {
            await ExistingPosts.markDeleted(post.id);
            deleted++;
          }
        }
      }
    }

    if (!dryRun) {
      await ExistingPosts.reconcileAlbumLinks();
      await ExistingPosts.validateReplyLinks();
      await ExistingPosts.cleanupEmptyPosts();
    }
  } finally {
    await client.disconnect();
  }

  const archiveAfter = dryRun ? archiveBefore : await ExistingPosts.getAll();
  const visiblePublished = (await _countVisiblePublished(archiveAfter));

  return {
    channelScanned,
    imported,
    updated,
    skipped,
    deleted,
    checked: channelScanned,
    synced: updated,
    archiveTotal: archiveAfter.length,
    visiblePublished
  };
}

async function _countVisiblePublished(posts) {
  const { shouldHideFromList, isEmptyPost } = require('../utils/albumPosts');
  return posts
    .filter((p) => p.lifecycleStatus !== 'deleted')
    .filter((p) => !shouldHideFromList(p, posts))
    .filter((p) => !isEmptyPost(p))
    .length;
}

function formatSyncReport(result, locale = 'ru') {
  const lines = [];
  if (locale === 'en') {
    lines.push('✅ Channel sync complete.');
    lines.push(`In channel: ${result.channelScanned}`);
    if (result.imported) lines.push(`Imported: ${result.imported}`);
    if (result.updated) lines.push(`Updated: ${result.updated}`);
    if (result.deleted) lines.push(`Marked deleted: ${result.deleted}`);
    if (!result.imported && !result.updated && !result.deleted) {
      lines.push('Archive matches channel.');
    }
    lines.push(`In archive: ${result.archiveTotal} (${result.visiblePublished} visible in history)`);
    return lines.join('\n');
  }

  lines.push('✅ Синхронизация с каналом завершена.');
  lines.push(`В канале: ${result.channelScanned}`);
  if (result.imported) lines.push(`Загружено: ${result.imported}`);
  if (result.updated) lines.push(`Обновлено: ${result.updated}`);
  if (result.deleted) lines.push(`Помечено удалёнными: ${result.deleted}`);
  if (!result.imported && !result.updated && !result.deleted) {
    lines.push('Архив совпадает с каналом.');
  }
  lines.push(`В архиве: ${result.archiveTotal} (${result.visiblePublished} в истории)`);
  return lines.join('\n');
}

module.exports = {
  canSync,
  syncChannel,
  formatSyncReport
};
