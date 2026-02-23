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

        // helpful logging to understand connectivity issues
        this.bot.on('polling_error', (err) => console.error('polling_error', err));
        this.bot.on('webhook_error', (err) => console.error('webhook_error', err));

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

        // acknowledge the callback to Telegram to prevent repeats
        this.bot.answerCallbackQuery(query.id).catch(() => {});

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
            // show draft content as preview
            try {
                await this.bot.copyMessage(userId, draft.chatId, draft.messageId);
            } catch (e) {
                console.error('preview failed', e);
            }
            stateManager.set(userId, { mode: 'draft_action', draftId, chatId: draft.chatId, messageId: draft.messageId });
            return this.bot.sendMessage(userId, 'Действие с черновиком:', MenuService.getDraftActionMenu(draftId));
        }

        if (data.startsWith('draft_publish_now_')) {
            const id = data.replace('draft_publish_now_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            const result = await this.postService.publish(draft.chatId, draft.messageId);
            await DraftService.remove(id);
            await this.sendPublishConfirmation(userId, result);
            stateManager.clear(userId);
            return;
        }

        if (data.startsWith('draft_publish_delay_')) {
            const id = data.replace('draft_publish_delay_', '');
            const draft = await DraftService.getById(userId, id);
            if (!draft) return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            const today = new Date();
            stateManager.set(userId, { mode: 'waiting_date', chatId: draft.chatId, messageId: draft.messageId, draftId: id });
            await this.bot.sendMessage(userId, 'Выберите дату для публикации:', MenuService.getCalendar(today.getFullYear(), today.getMonth()));
            return;
        }

        if (data.startsWith('draft_delete_')) {
            const id = data.replace('draft_delete_', '');
            stateManager.set(userId, { mode: 'confirm_delete', draftId: id });
            return this.bot.sendMessage(userId, 'Вы уверены, что хотите удалить черновик?', {
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
            if (!draft) return this.bot.sendMessage(userId, 'Черновик не найден.', MenuService.getMainMenu());
            // give user the existing content so they see what they're editing
            try {
                await this.bot.copyMessage(userId, draft.chatId, draft.messageId);
            } catch (e) { console.error('preview fail', e); }
            stateManager.set(userId, { mode: 'waiting_edit', draftId: id, chatId: draft.chatId, messageId: draft.messageId });
            await this.bot.sendMessage(userId, 'Отправьте новый текст/медиа для черновика:');
            return;
        }

        if (data === 'draft_cancel') {
            stateManager.clear(userId);
            await this.bot.sendMessage(userId, 'Действие отменено', MenuService.getMainMenu());
            return;
        }

        // calendar selection for date
        if (data.startsWith('calendar_')) {
            const dateStr = data.replace('calendar_', '');
            // store selected date and ask for time
            stateManager.set(userId, { mode: 'waiting_time', date: dateStr, ...state });
            await this.bot.sendMessage(userId, 'Введите время публикации в формате HH:mm');
            return;
        }

        // confirmation for deletion
        if (data === 'confirm_delete_yes') {
            const st = stateManager.get(userId);
            if (st?.mode === 'confirm_delete') {
                await DraftService.remove(st.draftId);
                await this.bot.sendMessage(userId, 'Черновик удалён ✅', MenuService.getMainMenu());
                stateManager.clear(userId);
            }
            return;
        }
        if (data === 'confirm_delete_no') {
            stateManager.clear(userId);
            return this.bot.sendMessage(userId, 'Удаление отменено', MenuService.getMainMenu());
        }

        if (!state?.chatId) return;

        switch (data) {
            case 'publish_now': {
                const result = await this.postService.publish(state.chatId, state.messageId);
                await this.sendPublishConfirmation(userId, result);
                stateManager.clear(userId);
                break;
            }
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
            // show the post exactly as it will appear in the channel
            try {
                await this.bot.copyMessage(userId, msg.chat.id, msg.message_id);
            } catch (e) {
                console.error('preview post failed', e);
            }
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
            return;
        }

        if (state.mode === 'waiting_date') {
            // user should select via calendar only
            return this.bot.sendMessage(userId, 'Пожалуйста, выберите дату нажатием на клавиатуру.');
        }

        if (state.mode === 'waiting_time') {
            const t = msg.text;
            const parts = t.split(':');
            if (parts.length !== 2) {
                return this.bot.sendMessage(userId, 'Неверный формат. Укажите время как HH:mm.');
            }
            const hour = parseInt(parts[0], 10);
            const minute = parseInt(parts[1], 10);
            if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
                return this.bot.sendMessage(userId, 'Неверный формат времени.');
            }
            const dateStr = state.date;
            const date = new Date(`${dateStr}T${t}`);
            if (date <= new Date()) {
                return this.bot.sendMessage(userId, 'Дата/время в прошлом, выберите другое.');
            }
            await this.postRepository.addScheduled(userId, state.chatId, state.messageId, date.toISOString());
            if (state.draftId) {
                await DraftService.remove(state.draftId);
            }
            await this.bot.sendMessage(userId, `Запланировано на ${date.toLocaleString()} ✅`, MenuService.getMainMenu());
            stateManager.clear(userId);
            return;
        }

        // if we reach here and message is not expected, ignore or inform
        return;
        if (state.mode === 'waiting_edit') {
            // show the new content as preview before saving
            try {
                await this.bot.copyMessage(userId, msg.chat.id, msg.message_id);
            } catch (e) {
                console.error('preview new edit failed', e);
            }
            // remove old draft message if possible to avoid clutter
            if (state.chatId && state.messageId) {
                this.bot.deleteMessage(state.chatId, state.messageId).catch(() => {});
            }
            // user sent new content for an existing draft
            await DraftService.update(state.draftId, userId, msg.chat.id, msg.message_id);
            await this.bot.sendMessage(userId, 'Черновик обновлён ✅', MenuService.getMainMenu());
            stateManager.clear(userId);
            return;
        }
    }

    // helper that notifies admin with link to the published post
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
            // fallback to t.me/c/ style for private channels
            const raw = String(channelMessage.chat.id);
            const id = raw.startsWith('-100') ? raw.slice(4) : raw.replace('-', '');
            url = `https://t.me/c/${id}/${channelMessage.message_id}`;
        }

        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Перейти в канал', url }]]
            }
        };
        await this.bot.sendMessage(userId, 'Пост опубликован ✅', opts);
    }
}

module.exports = BotService;