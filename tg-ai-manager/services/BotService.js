const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID } = require('../config');
const PostService = require('./PostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');
const DateParser = require('../utils/DateParser');

class BotService {
    constructor(postRepository) {
        this.bot = new TelegramBot(BOT_TOKEN, {
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 10 }
            }
        });

        this.postService = new PostService(this.bot);
        this.postRepository = postRepository;
        this.initHandlers();
    }

    isAdmin(userId) {
        return String(userId) === ADMIN_ID;
    }

    initHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.on('callback_query', (query) => this.handleCallback(query));
        this.bot.on('message', (msg) => this.handleMessage(msg));
    }

    async handleStart(msg) {
        if (!this.isAdmin(msg.from.id)) return;
        await this.bot.sendMessage(msg.chat.id, 'Выберите действие:', MenuService.getMainMenu());
    }

    async handleCallback(query) {
        const userId = query.from.id;
        if (!this.isAdmin(userId)) return;

        const data = query.data;
        const state = stateManager.get(userId);

        // global cancel/back button
        if (data === 'cancel') {
            stateManager.clear(userId);
            return this.bot.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
        }

        if (data === 'menu_publish') {
            stateManager.set(userId, { mode: 'waiting_post' });
            return this.bot.sendMessage(userId, 'Отправьте сообщение (текст, фото, видео) для публикации:');
        }

        if (data === 'menu_drafts') {
            const drafts = await DraftService.getAll(userId);
            if (drafts.length === 0) {
                return this.bot.sendMessage(userId, 'Черновиков нет.', MenuService.getMainMenu());
            }
            return this.bot.sendMessage(userId, 'Выберите черновик:', MenuService.getDraftsMenu(drafts));
        }

        if (data.startsWith('draft_select_')) {
            const draftId = data.replace('draft_select_', '');
            const draft = await DraftService.getById(userId, draftId);
            if (!draft) {
                return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            }
            stateManager.set(userId, { mode: 'draft_action', draftId, chatId: draft.chatId, messageId: draft.messageId });
            return this.bot.sendMessage(userId, 'Действие с черновиком:', MenuService.getDraftActionMenu(draftId));
        }

        if (data.startsWith('draft_publish_now_')) {
            const id = data.replace('draft_publish_now_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            await this.postService.publish(draft.chatId, draft.messageId);
            await DraftService.remove(id);
            await this.bot.sendMessage(userId, 'Пост опубликован ✅', MenuService.getMainMenu());
            stateManager.clear(userId);
            return;
        }

        if (data.startsWith('draft_publish_delay_')) {
            const id = data.replace('draft_publish_delay_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            stateManager.set(userId, { mode: 'waiting_datetime', chatId: draft.chatId, messageId: draft.messageId, draftId: id });
            await this.bot.sendMessage(userId, 'Укажите дату и время публикации в формате YYYY-MM-DD HH:mm или DD.MM.YYYY HH:mm');
            return;
        }

        if (data.startsWith('draft_delete_')) {
            const id = data.replace('draft_delete_', '');
            await DraftService.remove(id);
            await this.bot.sendMessage(userId, 'Черновик удалён', MenuService.getMainMenu());
            stateManager.clear(userId);
            return;
        }

        if (data === 'draft_cancel') {
            stateManager.clear(userId);
            await this.bot.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
            return;
        }

        if (!state?.chatId) return;

        switch (data) {
            case 'publish_now':
                await this.postService.publish(state.chatId, state.messageId);
                await this.bot.sendMessage(userId, 'Пост опубликован ✅', MenuService.getMainMenu());
                stateManager.clear(userId);
                break;
            case 'publish_delay':
                stateManager.set(userId, { ...state, mode: 'waiting_datetime' });
                await this.bot.sendMessage(userId, 'Укажите дату и время публикации в формате YYYY-MM-DD HH:mm или DD.MM.YYYY HH:mm');
                break;
            case 'save_draft':
                await DraftService.add(userId, state.chatId, state.messageId);
                await this.bot.sendMessage(userId, 'Сохранено в черновики ✅', MenuService.getMainMenu());
                stateManager.clear(userId);
                break;
            case 'cancel':
                stateManager.clear(userId);
                await this.bot.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
                break;
        }
    }

    async handleMessage(msg) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return;

        const state = stateManager.get(userId);
        if (!state) return;

        if (state.mode === 'waiting_post') {
            stateManager.set(userId, { mode: 'choose_post_action', chatId: msg.chat.id, messageId: msg.message_id });
            return this.bot.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu());
        }

        if (state.mode === 'waiting_datetime') {
            const input = msg.text;
            const date = DateParser.parse(input);
            if (!date || date <= new Date()) {
                return this.bot.sendMessage(userId, 'Некорректная дата/время. Попробуйте ещё раз.');
            }
            await this.postRepository.addScheduled(userId, state.chatId, state.messageId, date.toISOString());
            if (state.draftId) {
                await DraftService.remove(state.draftId);
            }
            await this.bot.sendMessage(userId, `Запланировано на ${date.toLocaleString()} ✅`, MenuService.getMainMenu());
            stateManager.clear(userId);
        }
    }
}

module.exports = BotService;