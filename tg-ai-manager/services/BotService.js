const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID } = require('../config');
const PostService = require('./PostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');

class BotService {
    constructor() {
        this.bot = new TelegramBot(BOT_TOKEN, {
            polling: {
                interval: 300,
                autoStart: true,
                params: {
                    timeout: 10
                }
            }
        });
        this.postService = new PostService(this.bot);
        this.initHandlers();
    }

    isAdmin(userId) { return String(userId) === ADMIN_ID; }

    initHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.on('callback_query', (query) => this.handleCallback(query));
        this.bot.on('message', (msg) => this.handleMessage(msg));
    }

    async handleStart(msg) {
        if (!this.isAdmin(msg.from.id)) return;

        await this.bot.sendMessage(
            msg.chat.id,
            "Выберите действие:",
            MenuService.getMainMenu()
        );
    }

    async handleCallback(query) {
        const userId = query.from.id;
        if (!this.isAdmin(userId)) return;

        const data = query.data;
        const state = stateManager.get(userId);

        if (data === "menu_publish") {
            stateManager.set(userId, { mode: "waiting_post" });
            return this.bot.sendMessage(userId, "Отправьте сообщение (текст, фото, видео) для публикации:");
        }

        if (!state?.chatId) return;

        switch (data) {
            case "publish_now":
                await this.postService.publish(state.chatId, state.messageId);
                await this.bot.sendMessage(userId, "Пост опубликован ✅", MenuService.getMainMenu());
                stateManager.clear(userId);
                break;
            case "publish_delay":
                stateManager.set(userId, { ...state, mode: "waiting_delay" });
                await this.bot.sendMessage(userId, "Через сколько минут опубликовать?");
                break;
            case "save_draft":
                await DraftService.add(userId, state.chatId, state.messageId);
                await this.bot.sendMessage(userId, "Сохранено в черновики ✅", MenuService.getMainMenu());
                stateManager.clear(userId);
                break;
            case "cancel":
                stateManager.clear(userId);
                await this.bot.sendMessage(userId, "Действие отменено", MenuService.getMainMenu());
                break;
        }
    }

    async handleMessage(msg) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return;

        const state = stateManager.get(userId);
        if (!state) return;

        if (state.mode === "waiting_post") {
            stateManager.set(userId, { mode: "choose_post_action", chatId: msg.chat.id, messageId: msg.message_id });
            return this.bot.sendMessage(userId, "Выберите действие с постом:", MenuService.getPostActionMenu());
        }

        if (state.mode === "waiting_delay") {
            const minutes = parseInt(msg.text);
            if (isNaN(minutes) || minutes <= 0) {
                return this.bot.sendMessage(userId, "Введите корректное количество минут");
            }
            this.postService.schedule(state.chatId, state.messageId, minutes);
            await this.bot.sendMessage(userId, `Запланировано через ${minutes} минут ✅`, MenuService.getMainMenu());
            stateManager.clear(userId);
        }
    }
}

module.exports = BotService;