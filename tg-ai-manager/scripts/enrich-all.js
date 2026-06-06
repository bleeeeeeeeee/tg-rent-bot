#!/usr/bin/env node
require('dotenv').config();

const SummaryService = require('../src/services/SummaryService');
const ExistingPosts = require('../src/services/ExistingPosts');

function parseArgs(argv) {
  const args = { missingOnly: true, limit: 100, force: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--all') args.missingOnly = false;
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]) || 100;
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  await ExistingPosts.migrateSchema();

  if (args.force) {
    const posts = await ExistingPosts.getAll();
    let enriched = 0;
    for (const post of posts.slice(0, args.limit)) {
      if (post.lifecycleStatus === 'deleted' || !post.post?.trim()) continue;
      const ok = await SummaryService.enrichPost(post.id, post.post, { force: true });
      if (ok) enriched++;
    }
    console.log(`Force enriched: ${enriched}`);
    return;
  }

  const result = await SummaryService.enrichAll({
    missingOnly: args.missingOnly,
    limit: args.limit
  });

  console.log(`Enriched: ${result.enriched}, skipped: ${result.skipped}`);
})();
