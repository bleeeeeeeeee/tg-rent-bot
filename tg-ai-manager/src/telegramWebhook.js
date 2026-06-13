const { URL } = require('url');

const ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'callback_query',
  'channel_post',
  'edited_channel_post'
];

function resolveWebhookMode(config) {
  const mode = config.BOT_MODE?.trim()?.toLowerCase();
  const url = config.WEBHOOK_URL?.trim();
  if (mode === 'webhook') return { useWebhook: true, url };
  if (mode === 'polling') return { useWebhook: false, url: null };
  if (url) return { useWebhook: true, url };
  return { useWebhook: false, url: null };
}

function parseWebhookUrl(webhookUrl) {
  const parsed = new URL(webhookUrl);
  const path = parsed.pathname && parsed.pathname !== '/'
    ? parsed.pathname
    : '/telegram/webhook';
  return { fullUrl: webhookUrl, path };
}

async function registerTelegramWebhook(bot, webhookUrl, secret) {
  const opts = { allowed_updates: ALLOWED_UPDATES };
  if (secret) opts.secret_token = secret;
  await bot.setWebHook(webhookUrl, opts);
}

async function unregisterTelegramWebhook(bot) {
  try {
    await bot.deleteWebHook({ drop_pending_updates: false });
  } catch (err) {
    console.error('[webhook] deleteWebHook:', err.message);
  }
}

module.exports = {
  ALLOWED_UPDATES,
  resolveWebhookMode,
  parseWebhookUrl,
  registerTelegramWebhook,
  unregisterTelegramWebhook
};
