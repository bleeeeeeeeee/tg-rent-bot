require('dotenv').config();

const OWNER_TELEGRAM_ID = process.env.OWNER_TELEGRAM_ID || process.env.ADMIN_ID;

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: String(OWNER_TELEGRAM_ID || process.env.ADMIN_ID || ''),
    OWNER_TELEGRAM_ID: String(OWNER_TELEGRAM_ID || process.env.ADMIN_ID || ''),
    CHANNEL_ID: process.env.CHANNEL_ID,
    TIMEZONE: process.env.TIMEZONE || 'Europe/Moscow',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    TG_API_ID: process.env.TG_API_ID || '',
    TG_API_HASH: process.env.TG_API_HASH || '',
    TG_SESSION: process.env.TG_SESSION || '',
    STORAGE_BACKEND: process.env.STORAGE_BACKEND || 'file',
    SUPABASE_URL: process.env.SUPABASE_URL || '',
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
    SYNC_ENABLED: process.env.SYNC_ENABLED === 'true',
    INSTANCE_ID: process.env.INSTANCE_ID || `local-${process.pid}`,
    BOT_MODE: process.env.BOT_MODE || 'polling',
    WEBHOOK_URL: process.env.WEBHOOK_URL || '',
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
    HEALTH_PORT: process.env.HEALTH_PORT || process.env.PORT || '8080'
};