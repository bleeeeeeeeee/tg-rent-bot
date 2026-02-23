require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN,
    ADMIN_ID: String(process.env.ADMIN_ID),
    CHANNEL_ID: process.env.CHANNEL_ID
};