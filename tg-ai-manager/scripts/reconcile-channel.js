#!/usr/bin/env node
require('dotenv').config();

const ChannelReconcileService = require('../src/services/ChannelReconcileService');

function parseArgs(argv) {
  const args = { dryRun: false, batchSize: 100, syncText: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--sync-text') args.syncText = true;
    else if (argv[i] === '--batch-size') args.batchSize = Number(argv[++i]) || 100;
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);

  if (!ChannelReconcileService.canReconcile()) {
    console.error('Need CHANNEL_ID, TG_API_ID, TG_API_HASH, TG_SESSION in .env. Run: npm run gram:login');
    process.exit(1);
  }

  const result = await ChannelReconcileService.reconcileChannel({
    dryRun: args.dryRun,
    batchSize: args.batchSize,
    syncText: args.syncText
  });

  console.log(
    `\nSync done. channel=${result.channelScanned} imported=${result.imported} updated=${result.updated} deleted=${result.deleted} archive=${result.archiveTotal} visible=${result.visiblePublished}`
  );
})().catch((err) => {
  console.error('Reconcile failed:', err.message);
  process.exit(1);
});
