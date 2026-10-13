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

  it('removes transient status messages on the next bot reply', async () => {
    const ChatCleanupService = require('../src/services/ChatCleanupService');
    const deleted = [];
    const bot = {
      deleteMessage: async (_chatId, messageId) => {
        deleted.push(messageId);
      }
    };

    ChatCleanupService.resetChat(1);
    ChatCleanupService.trackBotMessage(1, 50, { transient: true });
    ChatCleanupService.trackBotMessage(1, 51);
    await ChatCleanupService.flushTransient(bot, 1);

    assert.deepEqual(deleted, [50]);
    assert.deepEqual(ChatCleanupService.snapshotEphemeral(1), [51]);
    ChatCleanupService.resetChat(1);
  });

  it('flushSession removes persisted and in-memory UI messages', async () => {
    const ChatCleanupService = require('../src/services/ChatCleanupService');
    const UserSettingsService = require('../src/services/UserSettingsService');
    const deleted = [];
    const bot = {
      deleteMessage: async (_chatId, messageId) => {
        deleted.push(messageId);
      }
    };

    ChatCleanupService.resetChat(42);
    await UserSettingsService.setCleanupMessageIds(42, [5, 6]);
    let count = await ChatCleanupService.flushSession(bot, 42);
    assert.equal(count, 2);
    assert.deepEqual(deleted, [5, 6]);

    deleted.length = 0;
    ChatCleanupService.resetChat(42);
    ChatCleanupService.trackBotMessage(42, 10);
    ChatCleanupService.trackBotMessage(42, 11);
    count = await ChatCleanupService.flushSession(bot, 42);
    assert.equal(count, 2);
    assert.deepEqual(deleted.sort((a, b) => a - b), [10, 11]);
    ChatCleanupService.resetChat(42);
  });
});
