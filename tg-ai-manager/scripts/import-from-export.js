#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const ExistingPosts = require('../src/services/ExistingPosts');
const SummaryService = require('../src/services/SummaryService');
const { parseMediaFromExport } = require('./lib/exportParse');

function parseArgs(argv) {
  const args = { enrich: false, dryRun: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--enrich') args.enrich = true;
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (!argv[i].startsWith('--')) args.file = argv[i];
  }
  return args;
}

function extractExportText(textField) {
  if (!textField) return '';
  if (typeof textField === 'string') return textField;
  if (Array.isArray(textField)) {
    return textField
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.text) return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

function parseExportDate(msg) {
  if (msg.date) return new Date(msg.date).toISOString();
  if (msg.date_unixtime) return new Date(Number(msg.date_unixtime) * 1000).toISOString();
  return new Date().toISOString();
}

function parseEditedAt(msg) {
  if (msg.edited) return new Date(msg.edited).toISOString();
  if (msg.edited_unixtime) return new Date(Number(msg.edited_unixtime) * 1000).toISOString();
  return null;
}

(async () => {
  const args = parseArgs(process.argv);

  if (!args.file) {
    console.error('Usage: node scripts/import-from-export.js path/to/result.json [--enrich] [--dry-run]');
    process.exit(1);
  }

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  await ExistingPosts.migrateSchema();

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const messages = (raw.messages || []).filter((m) => m.type === 'message');

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const msg of messages) {
    const id = Number(msg.id);
    if (!id) continue;

    const postText = extractExportText(msg.text);
    const media = parseMediaFromExport(msg);
    const added = parseExportDate(msg);
    const editedAt = parseEditedAt(msg);
    const replyTo = msg.reply_to_message_id ? Number(msg.reply_to_message_id) : null;

    const payload = {
      id,
      post: postText,
      media,
      replyTo,
      mediaGroupId: msg.grouped_id != null ? String(msg.grouped_id) : null,
      added,
      lifecycleStatus: editedAt ? 'edited' : 'active',
      editedAt
    };

    if (args.dryRun) {
      console.log(`[dry-run] #${id} ${postText.slice(0, 40)}`);
      continue;
    }

    const result = await ExistingPosts.upsertPost(payload);
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
      limit: messages.length
    });
    console.log(`AI enriched: ${enriched}, skipped: ${enrichSkipped}`);
  }

  console.log(`\nDone. imported=${imported} updated=${updated} skipped=${skipped}`);
})();
