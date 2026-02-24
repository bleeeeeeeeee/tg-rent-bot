const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID } = require('../config');
const PostService = require('./PostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');
const DateParser = require('../utils/DateParser');
const { CHANNEL_ID } = require('../config');

class BotService {
    constructor(postRepository) {
        this.bot = new TelegramBot(BOT_TOKEN, {
            polling: {
                interval: 300,
                autoStart: true,
                params: { timeout: 10 }
            }
        });

        this.bot.on('polling_error', (err) => console.error('polling_error', err));
        this.bot.on('webhook_error', (err) => console.error('webhook_error', err));

        this.postService = new PostService(this.bot);
        this.postRepository = postRepository;
        this.initHandlers();
    }

    isAdmin(userId) {
        return String(userId) === ADMIN_ID;
    }

    async clearState(userId) {
        // just clear state, do not delete anything
        stateManager.clear(userId);
    }

    // cleanup helpers are currently disabled so chat history is preserved
    addCleanup(userId, msg) {
        // no-op
    }

    async sendMessage(userId, text, options) {
        // simply forward; no tracking
        return this.bot.sendMessage(userId, text, options);
    }

    async flushCleanup(userId) {
        // cleanup disabled
    }

    initHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.on('callback_query', (query) => this.handleCallback(query));
        this.bot.on('message', (msg) => this.handleMessage(msg));
    }

    async handleStart(msg) {
        if (!this.isAdmin(msg.from.id)) return;
        // reset any pending state when user explicitly restarts
        await this.clearState(msg.from.id);
        await this.sendMessage(msg.chat.id, 'Выберите действие:', MenuService.getMainMenu());
    }

    async handleCallback(query) {
        const userId = query.from.id;
        if (!this.isAdmin(userId)) return;

        this.bot.answerCallbackQuery(query.id).catch(() => {});

        await this.flushCleanup(userId);
        const data = query.data;
        const state = stateManager.get(userId);

        if (data === 'cancel') {
            await this.clearState(userId);
            return this.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
        }

        if (data === 'menu_publish') {
            stateManager.set(userId, { mode: 'waiting_post' });
            return this.sendMessage(userId, 'Отправьте сообщение (текст, фото, видео) для публикации:');
        }

        if (data === 'menu_drafts') {
            const drafts = await DraftService.getAll(userId);
            if (drafts.length === 0) {
                return this.sendMessage(userId, 'Черновиков нет.', MenuService.getMainMenu());
            }
            return this.sendMessage(userId, 'Выберите черновик:', MenuService.getDraftsMenu(drafts));
        }

        if (data.startsWith('draft_select_')) {
            const draftId = data.replace('draft_select_', '');
            const draft = await DraftService.getById(userId, draftId);
            if (!draft) {
                return this.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            }
            const copied = await this.bot.copyMessage(userId, draft.chatId, draft.messageId).catch(() => null);
            const newState = { mode: 'draft_action', draftId, chatId: draft.chatId, messageId: draft.messageId };
            if (copied && copied.message_id) newState.preview = copied.message_id;
            stateManager.set(userId, newState);
            return this.sendMessage(userId, 'Действие с черновиком:', MenuService.getDraftActionMenu(draftId));
        }

        if (data.startsWith('draft_publish_now_')) {
            const id = data.replace('draft_publish_now_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            const result = await this.postService.publish(draft.chatId, draft.messageId);
            await DraftService.remove(id);
            await this.sendPublishConfirmation(userId, result);
            await this.clearState(userId);
            return;
        }

        if (data.startsWith('draft_publish_delay_')) {
            const id = data.replace('draft_publish_delay_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            const today = new Date();
            stateManager.set(userId, { mode: 'waiting_date', chatId: draft.chatId, messageId: draft.messageId, draftId: id });
            await this.sendMessage(userId, 'Выберите дату для публикации:', MenuService.getCalendar(today.getFullYear(), today.getMonth()));
            return;
        }

        if (data.startsWith('draft_delete_')) {
            const id = data.replace('draft_delete_', '');
            stateManager.set(userId, { mode: 'confirm_delete', draftId: id });
            return this.sendMessage(userId, 'Вы уверены, что хотите удалить черновик?', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Да', callback_data: 'confirm_delete_yes' }, { text: '❌ Нет', callback_data: 'confirm_delete_no' }]
                    ]
                }
            });
        }

        if (data.startsWith('draft_edit_')) {
            const id = data.replace('draft_edit_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            try { await this.bot.copyMessage(userId, draft.chatId, draft.messageId); } catch {};
            stateManager.set(userId, { mode: 'waiting_edit', draftId: id, chatId: draft.chatId, messageId: draft.messageId });
            await this.sendMessage(userId, 'Отправьте новый текст/медиа для черновика:');
            return;
        }

        if (data === 'draft_cancel') {
            await this.clearState(userId);
            await this.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
            return;
        }

        if (data.startsWith('calendar_')) {
            const dateStr = data.replace('calendar_', '');
            stateManager.set(userId, { mode: 'waiting_time', date: dateStr, ...state });
            await this.sendMessage(userId, 'Введите время публикации в формате HH:mm');
            return;
        }

        if (data.startsWith('calendar_prev_') || data.startsWith('calendar_next_')) {
            const parts = data.split('_');
            const yearMonth = parts.slice(2).join('_');
            const [y, m] = yearMonth.split('-').map(Number);
            if (!isNaN(y) && !isNaN(m)) {
                await this.sendMessage(userId, 'Выберите дату:', MenuService.getCalendar(y, m));
            }
            return;
        }

        if (data === 'confirm_delete_yes') {
            const st = stateManager.get(userId);
            if (st?.mode === 'confirm_delete') {
                await DraftService.remove(st.draftId);
                await this.sendMessage(userId, 'Черновик удалён ✅', MenuService.getMainMenu());
                await this.clearState(userId);
            }
            return;
        }
        if (data === 'confirm_delete_no') {
            await this.clearState(userId);
            return this.sendMessage(userId, 'Удаление отменено', MenuService.getMainMenu());
        }

        if (!state?.chatId) return;

        switch (data) {
            case 'publish_now': {
                const result = await this.postService.publish(state.chatId, state.messageId);
                await this.sendPublishConfirmation(userId, result);
                await this.clearState(userId);
                break;
            }
            case 'publish_delay': {
                const today = new Date();
                stateManager.set(userId, { ...state, mode: 'waiting_date' });
                await this.sendMessage(userId, 'Выберите дату для публикации:', MenuService.getCalendar(today.getFullYear(), today.getMonth()));
                break;
            }
            case 'save_draft':
                await DraftService.add(userId, state.chatId, state.messageId);
                await this.sendMessage(userId, 'Сохранено в черновики ✅', MenuService.getMainMenu());
                await this.clearState(userId);
                break;
            case 'cancel':
                await this.clearState(userId);
                await this.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
                break;
        }
    }

    async handleMessage(msg) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return;

        // commands should not be treated as post content
        if (msg.text && msg.text.startsWith('/')) return;

        // no cleanup

        let state = stateManager.get(userId);
        if (!state) return;
        if (state.preview) {
            this.bot.deleteMessage(userId, state.preview).catch(() => {});
            delete state.preview;
            stateManager.set(userId, state);
        }

        if (state.mode === 'waiting_post') {
            const copied = await this.bot.copyMessage(userId, msg.chat.id, msg.message_id).catch(() => null);
            const newState = { mode: 'choose_post_action', chatId: msg.chat.id, messageId: msg.message_id };
            if (copied && copied.message_id) newState.preview = copied.message_id;
            stateManager.set(userId, newState);
            return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu());
        }


        if (state.mode === 'waiting_edit') {
            const copied = await this.bot.copyMessage(userId, msg.chat.id, msg.message_id).catch(() => null);
            if (state.chatId && state.messageId) this.bot.deleteMessage(state.chatId, state.messageId).catch(() => {});
            if (copied && copied.message_id) state.preview = copied.message_id;
            await DraftService.update(state.draftId, userId, msg.chat.id, msg.message_id);
            await this.sendMessage(userId, 'Черновик обновлён ✅', MenuService.getMainMenu());
            await this.clearState(userId);
            return;
        }

        if (state.mode === 'waiting_date') {
            return this.sendMessage(userId, 'Пожалуйста, выберите дату нажатием на клавиатуру.');
        }

        if (state.mode === 'waiting_time') {
            const t = msg.text;
            const parts = t.split(':');
            if (parts.length !== 2) return this.sendMessage(userId, 'Неверный формат. Укажите время как HH:mm.');
            const hour = parseInt(parts[0], 10), minute = parseInt(parts[1], 10);
            if (isNaN(hour) || isNaN(minute) || hour<0||hour>23||minute<0||minute>59) return this.sendMessage(userId, 'Неверный формат времени.');
            const date = new Date(`${state.date}T${t}`);
            if (date <= new Date()) return this.sendMessage(userId, 'Дата/время в прошлом, выберите другое.');
            await this.postRepository.addScheduled(userId, state.chatId, state.messageId, date.toISOString());
            if (state.draftId) await DraftService.remove(state.draftId);
            await this.sendMessage(userId, `Запланировано на ${date.toLocaleString()} ✅`, MenuService.getMainMenu());
            stateManager.clear(userId);
            return;
        }

        if (msg.text) await this.sendMessage(userId, 'Сейчас это сообщение не обрабатывается. Используйте меню.');
        return;    }

    async sendPublishConfirmation(userId, channelMessage) {
        let url = null;
        try {
            const chat = await this.bot.getChat(CHANNEL_ID || channelMessage.chat.id);
            if (chat.username) {
                url = `https://t.me/${chat.username}/${channelMessage.message_id}`;
            }
        } catch (e) {
            console.error('getChat failed', e);
        }
        if (!url) {
            const raw = String(channelMessage.chat.id);
            const id = raw.startsWith('-100') ? raw.slice(4) : raw.replace('-', '');
            url = `https://t.me/c/${id}/${channelMessage.message_id}`;
        }

        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Перейти в канал', url }]]
            }
        };
        await this.sendMessage(userId, 'Пост опубликован ✅', opts);
        await this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
    }
}

module.exports = BotService;