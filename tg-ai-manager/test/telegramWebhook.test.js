const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveWebhookMode, parseWebhookUrl } = require('../src/telegramWebhook');

describe('telegramWebhook', () => {
  it('defaults to polling without WEBHOOK_URL', () => {
    const mode = resolveWebhookMode({ BOT_MODE: 'polling', WEBHOOK_URL: '' });
    assert.equal(mode.useWebhook, false);
  });

  it('uses webhook when BOT_MODE=webhook', () => {
    const mode = resolveWebhookMode({
      BOT_MODE: 'webhook',
      WEBHOOK_URL: 'https://app.example.com/telegram/webhook'
    });
    assert.equal(mode.useWebhook, true);
    assert.equal(mode.url, 'https://app.example.com/telegram/webhook');
  });

  it('auto-enables webhook when WEBHOOK_URL is set and mode not forced', () => {
    const mode = resolveWebhookMode({
      BOT_MODE: '',
      WEBHOOK_URL: 'https://app.example.com/telegram/webhook'
    });
    assert.equal(mode.useWebhook, true);
  });

  it('forces polling when BOT_MODE=polling even with URL', () => {
    const mode = resolveWebhookMode({
      BOT_MODE: 'polling',
      WEBHOOK_URL: 'https://app.example.com/telegram/webhook'
    });
    assert.equal(mode.useWebhook, false);
  });

  it('parses webhook path from URL', () => {
    const parsed = parseWebhookUrl('https://host.nflk.io/telegram/webhook');
    assert.equal(parsed.path, '/telegram/webhook');
    assert.equal(parsed.fullUrl, 'https://host.nflk.io/telegram/webhook');
  });
});
