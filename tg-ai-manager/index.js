require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN = process.env.ADMIN_ID;
const CHANNEL = process.env.CHANNEL_ID;

if (!ADMIN || !process.env.BOT_TOKEN) {
    console.error("❌ BOT_TOKEN или ADMIN_ID не указан.");
    process.exit(1);
}

bot.onText(/\/start/, msg => {
    if (String(msg.from.id) !== ADMIN) return;
    bot.sendMessage(msg.chat.id, `✅ TG AI Manager\nВаш ADMIN_ID: ${ADMIN}\n/getid — получить ID чата\n/post текст — опубликовать пост`);
});

bot.onText(/\/getid/, msg => {
    if (String(msg.from.id) !== ADMIN) return;
    bot.sendMessage(msg.chat.id, `Chat ID этого чата/канала: ${msg.chat.id}`);
});

bot.onText(/\/post (.+)/, async (msg, match) => {
    if (String(msg.from.id) !== ADMIN) return;
    if (!CHANNEL) return bot.sendMessage(msg.chat.id, "❌ CHANNEL_ID не указан в .env");
    await bot.sendMessage(CHANNEL, match[1]);
    bot.sendMessage(msg.chat.id, "✅ Пост опубликован");
});

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);