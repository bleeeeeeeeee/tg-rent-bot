const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  appendEditSnapshot,
  buildEditTimeline,
  countEdits
} = require('../src/utils/postEditHistory');

describe('postEditHistory', () => {
  it('records snapshots before text changes', () => {
    const existing = {
      post: 'A',
      added: '2024-01-01T00:00:00.000Z',
      editHistory: []
    };
    const history = appendEditSnapshot(existing, 'channel');
    assert.equal(history.length, 1);
    assert.equal(history[0].post, 'A');
  });

  it('builds timeline with original and current', () => {
    const timeline = buildEditTimeline({
      post: 'B',
      postOriginal: 'A',
      editHistory: [{ at: '2024-01-02T00:00:00.000Z', post: 'A', source: 'channel' }],
      added: '2024-01-01T00:00:00.000Z',
      editedAt: '2024-01-02T00:00:00.000Z',
      lifecycleStatus: 'edited'
    });
    assert.ok(timeline.some((e) => e.kind === 'original' && e.post === 'A'));
    assert.ok(timeline.some((e) => e.kind === 'current' && e.post === 'B'));
  });

  it('counts edits from history', () => {
    assert.equal(countEdits({ editHistory: [{ post: 'x' }, { post: 'y' }] }), 2);
  });
});
