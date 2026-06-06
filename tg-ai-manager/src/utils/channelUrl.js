const { CHANNEL_ID } = require('../config');

let channelUrlPrefix = null;

async function initChannelUrl(bot) {
  try {
    const chat = await bot.getChat(CHANNEL_ID);
    if (chat.username) {
      channelUrlPrefix = `https://t.me/${chat.username}`;
    } else {
      const raw = String(chat.id);
      const id = raw.startsWith('-100') ? raw.slice(4) : raw.replace('-', '');
      channelUrlPrefix = `https://t.me/c/${id}`;
    }
  } catch (err) {
    console.error('[channelUrl] init failed:', err.message);
    channelUrlPrefix = null;
  }
}

function getChannelUrlPrefix() {
  return channelUrlPrefix;
}

function buildChannelUrl() {
  return channelUrlPrefix;
}

async function resolveChannelUrl(bot) {
  if (channelUrlPrefix) return channelUrlPrefix;
  await initChannelUrl(bot);
  if (channelUrlPrefix) return channelUrlPrefix;
  const configured = String(CHANNEL_ID);
  if (configured.startsWith('@')) {
    return `https://t.me/${configured.slice(1)}`;
  }
  return null;
}

async function resolveChannelDisplay(bot) {
  const url = await resolveChannelUrl(bot);
  if (!url) return null;

  let title = null;
  let username = null;
  try {
    const chat = await bot.getChat(CHANNEL_ID);
    title = chat.title?.trim() || null;
    username = chat.username ? `@${chat.username}` : null;
  } catch (err) {
    console.error('[channelUrl] getChat failed:', err.message);
  }

  const configured = String(CHANNEL_ID);
  if (!title && configured.startsWith('@')) {
    title = configured;
    username = configured;
  }
  if (!title) title = 'Канал';
  
  const buttonLabel = username ? `Открыть` : 'Перейти в канал';
  // const buttonLabel = username ? `Открыть ${username}` : 'Перейти в канал';

  return { url, title, username, buttonLabel };
}

function buildPostUrl(messageId) {
  if (!channelUrlPrefix || messageId == null) return null;
  return `${channelUrlPrefix}/${messageId}`;
}

module.exports = {
  initChannelUrl,
  getChannelUrlPrefix,
  buildChannelUrl,
  resolveChannelUrl,
  resolveChannelDisplay,
  buildPostUrl
};
