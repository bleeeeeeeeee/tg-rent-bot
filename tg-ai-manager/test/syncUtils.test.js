const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isCollectionEmpty, countCollection } = require('../src/storage/syncUtils');

describe('syncUtils', () => {
  it('detects empty secrets', () => {
    assert.equal(isCollectionEmpty('secrets', { providers: {} }), true);
    assert.equal(isCollectionEmpty('secrets', { providers: { openai: { apiKey: 'x' } } }), false);
  });

  it('counts settings ai fields', () => {
    assert.equal(countCollection('settings', { ai: { activeProvider: 'openai' } }), 1);
    assert.equal(isCollectionEmpty('settings', {}), true);
  });
});
