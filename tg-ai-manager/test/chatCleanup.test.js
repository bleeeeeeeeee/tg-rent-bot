const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('ChatCleanupService stack', () => {
  it('snapshot captures ephemeral before new send', async () => {
    const ChatCleanupService = require('../src/services/ChatCleanupService');
    ChatCleanupService.resetChat(1);
    ChatCleanupService.trackBotMessage(1, 100);
    ChatCleanupService.trackBotMessage(1, 200, { pinned: true });

    const snap = ChatCleanupService.snapshotEphemeral(1);
    assert.deepEqual(snap, [100]);

    ChatCleanupService.trackBotMessage(1, 300);
    await ChatCleanupService.deleteMessages(
      { deleteMessage: async () => {} },
      1,
      snap
    );

    assert.deepEqual(ChatCleanupService.snapshotEphemeral(1), [300]);
    assert.deepEqual(ChatCleanupService.snapshotEphemeral(1).includes(200), false);
    ChatCleanupService.resetChat(1);
  });
});
