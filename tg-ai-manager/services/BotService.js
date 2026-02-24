const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID } = require('../config');
const PostService = require('./PostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');
const { CHANNEL_ID } = require('../config');
const HistoryRepository = require('./HistoryRepository');
const SummaryService = require('./SummaryService');

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

        // prepare channel url base for history links
        this.channelUrlPrefix = null;
        this.prefixReady = this.initChannelUrlPrefix();

        this.initHandlers();

        // once the channel prefix is ready, perform a one‑time silent sync of existing posts
        this.prefixReady.then(() => {
            this.syncHistory(true).catch(err => console.error('initial sync failed', err));
        });
    }

    isAdmin(userId) {
        return String(userId) === ADMIN_ID;
    }

    async clearState(userId) {
        stateManager.clear(userId);
    }

    async sendMessage(userId, text, options = {}) {
        // prepare markup object
        options.reply_markup = options.reply_markup || {};
        // if we are sending an inline keyboard we should also clear any
        // existing reply keyboard so the user sees buttons clearly.
        if (options.reply_markup.inline_keyboard) {
            options.reply_markup.remove_keyboard = true;
        }
        // otherwise, add a simple reply keyboard with a menu button if nothing
        // else is present.
        if (!options.reply_markup.inline_keyboard && !options.reply_markup.keyboard) {
            options.reply_markup.keyboard = [[{ text: 'Главное меню' }]];
            options.reply_markup.resize_keyboard = true;
        }
        return this.bot.sendMessage(userId, text, options);
    }

    initHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.onText(/\/history(?:\s+(.+))?/, (msg, match) => this.handleHistory(msg, match));
        this.bot.onText(/\/pinchannel/, (msg) => this.handlePinChannel(msg));
        this.bot.onText(/\/sync/, (msg) => this.handleSyncCommand(msg));
        this.bot.on('callback_query', (query) => this.handleCallback(query));
        this.bot.on('message', (msg) => this.handleMessage(msg));
        this.bot.on('edited_message', (msg) => this.handleEdited(msg));
    }

    async handleStart(msg) {
        if (!this.isAdmin(msg.from.id)) return;
        // reset any pending state when user explicitly restarts
        await this.clearState(msg.from.id);
        await this.sendMessage(msg.chat.id, 'Выберите действие:', MenuService.getMainMenu());
    }

    async handleSyncCommand(msg) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return;
        await this.sendMessage(userId, 'Запускаю синхронизацию истории (в фоне). Пожалуйста, подождите.');
        this.syncHistory().catch(e => {
            console.error('manual sync error', e);
            this.sendMessage(userId, 'Синхронизация завершилась с ошибкой.');
        });
    }

    /**
     * Synchronize channel history into our local file.
     * Posts already present are skipped; new entries are summarized and added.
     * This method is safe to call multiple times; it will only touch missing IDs.
     */
    /**
     * Synchronize channel history into our local file.
     * @param {boolean} silent - when true, do not send messages to admin; used at startup.
     */
    async syncHistory(silent = false) {
        await this.prefixReady;
        const existing = new Set((await HistoryRepository.getAll()).map(r => Number(r.messageId)));
        let added = 0;
        const maxExisting = existing.size ? Math.max(...existing) : 0;
        const MAX_SEARCH = 1000000; // search up to one million IDs to be safe
        let consecutiveMisses = 0;
        for (let id = 1; id <= MAX_SEARCH; id++) {
            if (existing.has(id)) {
                consecutiveMisses = 0;
                continue;
            }
            try {
                const copy = await this.bot.copyMessage(ADMIN_ID, CHANNEL_ID, id);
                if (copy && copy.message_id) {
                    await this.bot.deleteMessage(ADMIN_ID, copy.message_id).catch(() => {});
                }
                const text = (copy.text || '') + (copy.caption ? '\n' + copy.caption : '');
                let summary = null;
                if (!text.trim()) {
                    summary = { main: '<медиа>', description: '<медиа>' };
                } else {
                    summary = await SummaryService.summarize(text);
                }
                await HistoryRepository.addPublished('', CHANNEL_ID, id, summary, copy.date || null);
                added++;
                existing.add(id);
                consecutiveMisses = 0;
            } catch (e) {
                consecutiveMisses++;
                // if we've gone far beyond any existing id and are failing repeatedly,
                // assume we've passed the last message and can stop early.
                if (id > maxExisting && consecutiveMisses >= 500) break;
            }
        }
        if (!silent) {
            if (added > 0) {
                await this.sendMessage(ADMIN_ID, `Синхронизировано ${added} постов истории.`);
            } else {
                await this.sendMessage(ADMIN_ID, 'Новых постов для синхронизации не найдено.');
            }
        }
    }

    async initChannelUrlPrefix() {
        try {
            const chat = await this.bot.getChat(CHANNEL_ID);
            if (chat.username) {
                this.channelUrlPrefix = `https://t.me/${chat.username}`;
                return;
            }
        } catch (e) {
            console.error('initChannelUrlPrefix error', e);
        }
        const raw = String(CHANNEL_ID || '');
        const id = raw.startsWith('-100') ? raw.slice(4) : raw.replace('-', '');
        this.channelUrlPrefix = `https://t.me/c/${id}`;
    }

    async handleHistory(msg, match) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return; // safety
        await this.prefixReady;
        const term = match && match[1] ? match[1].trim().toLowerCase() : null;
        const records = await HistoryRepository.getAll();
        let filtered = records;
        if (term) {
            filtered = records.filter(r => {
                const hay = [r.title, r.main, r.description, ...(r.keywords||[])].join(' ').toLowerCase();
                return hay.includes(term);
            });
        }
        if (filtered.length === 0) {
            const reply = term ? 'Записей с таким запросом нет.' : 'История публикаций пуста.';
            await this.sendMessage(userId, reply);
            return this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
        }
        // build a single text message with all entries (limit to 50 for safety)
        const header = 'История публикаций' + (term ? ` (по «${term}»)` : '') + ' (новейшие сверху)';
        let text = header + '\n\n';
        const limit = 50;
        for (let i = 0; i < Math.min(filtered.length, limit); i++) {
            const r = filtered[i];
            const url = this.channelUrlPrefix ? `${this.channelUrlPrefix}/${r.messageId}` : '';
            // topic is main idea, description carries the detailed message
            const topic = r.main || r.title || `пост ${i+1}`;
            text += `${i+1}. *${topic}*`;
            text += '\n';
            const desc = r.description || r.main || '';
            if (desc) text += `${desc}\n`;
            if (url) text += `[Ссылка на пост](${url})\n`;
            text += '\n';
        }
        if (filtered.length > limit) {
            text += `...и ещё ${filtered.length - limit} записей`;
        }
        const opts = { parse_mode: 'Markdown', disable_web_page_preview: true };
        await this.sendMessage(userId, text.trim(), opts);
        await this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
    }

    async handlePinChannel(msg) {
        const userId = msg.from.id;
        if (!this.isAdmin(userId)) return;
        await this.prefixReady;
        const url = this.channelUrlPrefix || 'https://t.me/' + CHANNEL_ID;
        const text = 'Наш канал:';
        const opts = {
            reply_markup: {
                inline_keyboard: [[{ text: 'Перейти в канал', url }]]
            }
        };
        const m = await this.sendMessage(userId, text, opts);
        try { await this.bot.pinChatMessage(userId, m.message_id); } catch (e) { console.error('pin failed', e); }
    }

    async handleCallback(query) {
        const userId = query.from.id;
        if (!this.isAdmin(userId)) return;

        this.bot.answerCallbackQuery(query.id).catch(() => {});

        // remove inline keyboard from the message that generated this callback
        if (query.message) {
            this.bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            }).catch(() => {});
        }

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

        if (data === 'menu_history') {
            await this.clearState(userId);
            return this.sendMessage(userId, 'Как вывести историю?', MenuService.getHistorySourceMenu());
        }


        if (data === 'history_chat') {
            // reuse existing history handler
            await this.clearState(userId);
            await this.handleHistory({ from: { id: userId } }, [null]);
            return;
        }

        if (data === 'history_file') {
            await this.clearState(userId);
            // convert history to CSV for easier viewing
            const recs = await HistoryRepository.getAll();
            let csv = 'publishedAt,userId,chatId,messageId,title,main,description,keywords\n';
            for (const r of recs) {
                const line = [r.publishedAt, r.userId, r.chatId, r.messageId,
                    r.title, r.main, r.description,
                    (r.keywords||[]).join('|')]
                    .map(v => '"' + String(v||'').replace(/"/g,'""') + '"')
                    .join(',');
                csv += line + '\n';
            }
            try {
                await this.bot.sendDocument(userId, Buffer.from(csv), { filename: 'history.csv' });
            } catch (e) {
                console.error('send history file failed', e);
                await this.sendMessage(userId, 'Не удалось отправить файл.');
            }
            return this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
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
            const result = await this.postService.publish(userId, draft.chatId, draft.messageId);
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
            await this.sendMessage(userId, 'Либо выберите действие:', MenuService.getMainMenu());
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
                const result = await this.postService.publish(userId, state.chatId, state.messageId);
                await this.sendPublishConfirmation(userId, result);
                await this.clearState(userId);
                break;
            }
            case 'publish_delay': {
                const today = new Date();
                stateManager.set(userId, { ...state, mode: 'waiting_date' });
                await this.sendMessage(userId, 'Выберите дату для публикации:', MenuService.getCalendar(today.getFullYear(), today.getMonth()));
                // also give user option to return to menu
                await this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
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

        // allow quick menu button
        if (msg.text === 'Главное меню') {
            await this.clearState(userId);
            return this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
        }

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
        await this.prefixReady;
        const url = this.channelUrlPrefix
            ? `${this.channelUrlPrefix}/${channelMessage.message_id}`
            : null;
        try {
            if (url) {
                const opts = {
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Перейти в канал', url }]]
                    }
                };
                await this.sendMessage(userId, 'Пост опубликован ✅', opts);
            } else {
                await this.sendMessage(userId, 'Пост опубликован ✅');
            }
        } catch (e) {
            console.error('publish confirmation failed', e);
            await this.sendMessage(userId, 'Пост опубликован ✅');
        }
        await this.sendMessage(userId, 'Выберите действие:', MenuService.getMainMenu());
    }

    async handleEdited(msg) {
        if (!msg || !msg.chat) return;
        if (String(msg.chat.id) !== String(CHANNEL_ID)) return;
        const text = (msg.text || '') + (msg.caption ? '\n' + msg.caption : '');
        const summary = await SummaryService.summarize(text);
        if (summary) {
            await HistoryRepository.updateSummary(msg.message_id, summary);
        }
    }
}

module.exports = BotService;