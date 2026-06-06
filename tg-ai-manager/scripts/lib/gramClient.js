require('dotenv').config();

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { TG_API_ID, TG_API_HASH, TG_SESSION } = require('../../src/config');

async function createGramClient() {
  if (!TG_API_ID || !TG_API_HASH) {
    throw new Error('TG_API_ID and TG_API_HASH are required in .env');
  }
  if (!TG_SESSION) {
    throw new Error(
      'TG_SESSION not found in .env. Run: npm run gram:login (then check that .env contains TG_SESSION=...)'
    );
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
