#!/usr/bin/env node
require('dotenv').config();

const { CHANNEL_ID } = require('../src/config');
const ExistingPosts = require('../src/services/ExistingPosts');
const SummaryService = require('../src/services/SummaryService');
const { createGramClient } = require('./lib/gramClient');
const { parseMediaFromGramMessage, extractGramText } = require('./lib/exportParse');

function parseArgs(argv) {
  const args = { limit: 500, offsetId: 0, enrich: false, dryRun: false, force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--enrich') args.enrich = true;
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]) || 500;
    else if (argv[i] === '--offset-id') args.offsetId = Number(argv[++i]) || 0;
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);

  await ExistingPosts.migrateSchema();
  const client = await createGramClient();

  try {
    const entity = await client.getEntity(CHANNEL_ID);
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let processed = 0;

    const iterOpts = { limit: args.limit };
    if (args.offsetId) iterOpts.offsetId = args.offsetId;

    for await (const message of client.iterMessages(entity, iterOpts)) {
      if (!message?.id) continue;
      processed++;

      const postText = extractGramText(message);
      const media = parseMediaFromGramMessage(message);
      const added = message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString();
      const editedAt = message.editDate ? new Date(message.editDate * 1000).toISOString() : null;
      const replyTo = message.replyTo?.replyToMsgId
        ? Number(message.replyTo.replyToMsgId)
        : null;
      const mediaGroupId = message.groupedId != null ? String(message.groupedId) : null;

      const payload = {
        id: message.id,
        post: postText,
        media,
        replyTo,
        mediaGroupId,
        added,
        lifecycleStatus: editedAt ? 'edited' : 'active',
        editedAt
      };

      if (args.dryRun) {
        console.log(`[dry-run] #${message.id} ${postText.slice(0, 50)}`);
        continue;
      }

      const result = await ExistingPosts.upsertPost(payload, { force: args.force });
      if (result.action === 'imported') imported++;
      else if (result.action === 'updated') updated++;
      else skipped++;
    }

    if (!args.dryRun) {
      await ExistingPosts.reconcileAlbumLinks();
      const fixed = await ExistingPosts.validateReplyLinks();
      console.log(`Reply links validated, missing flags: ${fixed}`);
    }

    if (args.enrich && !args.dryRun) {
      const { enriched, skipped: enrichSkipped } = await SummaryService.enrichAll({
        missingOnly: true,
        limit: processed
      });
      console.log(`AI enriched: ${enriched}, skipped: ${enrichSkipped}`);
    }

    console.log(`\nDone. processed=${processed} imported=${imported} updated=${updated} skipped=${skipped}`);
  } finally {
    await client.disconnect();
  }
})().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
