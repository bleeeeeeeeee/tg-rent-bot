const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  gramMessageToPostPayload,
  shouldImportGramMessage,
  isGramServiceMessage
} = require('../src/utils/gramMessage');

describe('gramMessage', () => {
  it('skips service messages', () => {
    assert.equal(isGramServiceMessage({ id: 1, action: {} }), true);
    assert.equal(shouldImportGramMessage({ id: 2, action: {} }), false);
  });

  it('imports text posts with channel date', () => {
    const payload = gramMessageToPostPayload({
      id: 42,
      message: 'Hello channel',
      date: 1_700_000_000
    });
    assert.equal(payload.id, 42);
    assert.equal(payload.post, 'Hello channel');
    assert.equal(payload.lifecycleStatus, 'active');
    assert.ok(payload.added.includes('2023'));
  });

  it('imports media-only posts', () => {
    assert.equal(
      shouldImportGramMessage({ id: 7, photo: {}, message: '' }),
      true
    );
  });
});
