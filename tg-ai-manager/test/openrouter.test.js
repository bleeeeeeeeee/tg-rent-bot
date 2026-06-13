const test = require('node:test');
const assert = require('node:assert/strict');

const openrouter = require('../src/ai/providers/openrouter');

test('OpenRouter validateConfig checks /api/v1/key not chat completion', async () => {
  const originalFetch = global.fetch;
  let calledUrl = null;

  global.fetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { label: 'sk-or-test' } })
    };
  };

  try {
    await openrouter.validateConfig({ apiKey: 'sk-or-v1-test' }, 'meta-llama/llama-3.2-3b-instruct:free');
    assert.equal(calledUrl, 'https://openrouter.ai/api/v1/key');
  } finally {
    global.fetch = originalFetch;
  }
});

test('OpenRouter validateConfig rejects invalid key', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 401, text: async () => 'unauthorized' });

  try {
    await assert.rejects(
      () => openrouter.validateConfig({ apiKey: 'sk-or-v1-bad' }),
      /Invalid API key/
    );
  } finally {
    global.fetch = originalFetch;
  }
});
