require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: String(process.env.ADMIN_ID),
    CHANNEL_ID: process.env.CHANNEL_ID,
    TIMEZONE: process.env.TIMEZONE || 'Europe/Moscow',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    TG_API_ID: process.env.TG_API_ID || '',
    TG_API_HASH: process.env.TG_API_HASH || '',
    TG_SESSION: process.env.TG_SESSION || ''
};