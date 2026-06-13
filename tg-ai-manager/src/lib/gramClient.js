const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { TG_API_ID, TG_API_HASH, TG_SESSION } = require('../config');

async function createGramClient() {
  if (!TG_API_ID || !TG_API_HASH) {
    throw new Error('TG_API_ID and TG_API_HASH are required');
  }
  if (!TG_SESSION) {
    throw new Error('TG_SESSION not found. Run: npm run gram:login');
  }

  const client = new TelegramClient(
    new StringSession(TG_SESSION),
    Number(TG_API_ID),
    TG_API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();
  return client;
}

module.exports = { createGramClient };
