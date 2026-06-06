const { CHANNEL_ID, TG_API_ID, TG_API_HASH, TG_SESSION } = require('../config');
const ExistingPosts = require('./ExistingPosts');

function canReconcile() {
  return Boolean(CHANNEL_ID && TG_API_ID && TG_API_HASH && TG_SESSION);
}

async function reconcileChannel({ syncText = false, batchSize = 100, dryRun = false } = {}) {
  if (!canReconcile()) {
    throw new Error(
      'Нужны CHANNEL_ID, TG_API_ID, TG_API_HASH и TG_SESSION в .env. Сессия: npm run gram:login'
    );
  }

  const { createGramClient } = require('../../scripts/lib/gramClient');
  const { parseMediaFromGramMessage, extractGramText } = require('../../scripts/lib/exportParse');

  await ExistingPosts.migrateSchema();
  const posts = (await ExistingPosts.getAll()).filter((p) => p.lifecycleStatus !== 'deleted');

  if (posts.length === 0) {
    return { checked: 0, deleted: 0, synced: 0 };
  }

  const client = await createGramClient();
  let deleted = 0;
  let synced = 0;

  try {
    const entity = await client.getEntity(CHANNEL_ID);

    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);
      const messages = await client.getMessages(entity, { ids: batch.map((p) => p.id) });
      const foundIds = new Set(messages.filter((m) => m?.id).map((m) => m.id));

      for (const post of batch) {
        if (!foundIds.has(post.id)) {
          if (!dryRun) await ExistingPosts.markDeleted(post.id);
          deleted++;
          continue;
        }

        if (syncText) {
          const msg = messages.find((m) => m?.id === post.id);
          if (!msg) continue;
          const postText = extractGramText(msg);
          const media = parseMediaFromGramMessage(msg);
          const editedAt = msg.editDate ? new Date(msg.editDate * 1000).toISOString() : null;

          if (!dryRun) {
            await ExistingPosts.upsertPost({
              id: post.id,
              post: postText,
              media,
              lifecycleStatus: editedAt ? 'edited' : post.lifecycleStatus,
              editedAt: editedAt || post.editedAt
            });
          }
          synced++;
        }
      }
    }
  } finally {
    await client.disconnect();
  }

  return { checked: posts.length, deleted, synced };
}

module.exports = { canReconcile, reconcileChannel };
