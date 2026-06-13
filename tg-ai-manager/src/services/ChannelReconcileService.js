const ChannelSyncService = require('./ChannelSyncService');

function canReconcile() {
  return ChannelSyncService.canSync();
}

async function reconcileChannel(options = {}) {
  return ChannelSyncService.syncChannel({
    limit: 0,
    markDeleted: true,
    syncText: options.syncText ?? true,
    dryRun: options.dryRun ?? false,
    batchSize: options.batchSize ?? 100
  });
}

module.exports = { canReconcile, reconcileChannel };
