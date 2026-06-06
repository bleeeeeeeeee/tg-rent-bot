#!/usr/bin/env node
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { TG_API_ID, TG_API_HASH } = require('../src/config');

const ENV_PATH = path.join(__dirname, '..', '.env');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function saveSessionToEnv(sessionString) {
  let content = '';
  try {
    content = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const line = `TG_SESSION=${sessionString}`;
  if (/^TG_SESSION=/m.test(content)) {
    content = content.replace(/^TG_SESSION=.*$/m, line);
  } else if (content.length && !content.endsWith('\n')) {
    content += `\n${line}\n`;
  } else {
    content += `${line}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

(async () => {
  if (!TG_API_ID || !TG_API_HASH) {
    console.error('Set TG_API_ID and TG_API_HASH in .env (from https://my.telegram.org)');
    process.exit(1);
  }

  console.log('GramJS login — вход вашим аккаунтом Telegram (не ботом).\n');
  console.log('Нужен для npm run import:channel и npm run reconcile.\n');

  const session = new StringSession('');
  const client = new TelegramClient(session, Number(TG_API_ID), TG_API_HASH, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => ask('Phone (+7999...): '),
    password: async () => ask('2FA password (if any): '),
    phoneCode: async () => ask('Code from Telegram: '),
    onError: (err) => console.error(err)
  });

  const sessionString = client.session.save();
  saveSessionToEnv(sessionString);

  console.log('\n✅ Вход выполнен. TG_SESSION записан в .env');
  console.log('Дальше: npm run import:channel\n');
  await client.disconnect();
})();
