class MenuService {
    static async _ui(ui) {
        if (ui) return ui;
        return require('./UiStyleService').get();
    }

    static _L(ui, emoji, text) {
        const UiStyleService = require('./UiStyleService');
        return UiStyleService.optionalEmoji(ui, emoji, text);
    }

    static _mark(ui, selected) {
        if (!selected) return '';
        return require('./UiStyleService').selectedMark(ui);
    }

    static async getMainMenu(ui = null) {
        ui = await this._ui(ui);
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(ui, '📢', 'Публикация'), callback_data: 'menu_publish' }],
                    [{ text: this._L(ui, '📝', 'Черновики'), callback_data: 'menu_drafts' }],
                    [{ text: this._L(ui, '📚', 'История'), callback_data: 'menu_history' }],
                    [{ text: this._L(ui, '⚙️', 'Настройки'), callback_data: 'menu_settings' }]
                ]
            }
        };
    }

    static async getPublishModeMenu(ui = null) {
        ui = await this._ui(ui);
        const UiStyleService = require('./UiStyleService');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(ui, '📤', 'Отправить готовый пост'), callback_data: 'publish_mode_ready' }],
                    [{ text: this._L(ui, '✨', 'Написать с ИИ'), callback_data: 'publish_mode_ai' }],
                    [{ text: UiStyleService.backLabel(ui), callback_data: 'cancel' }]
                ]
            }
        };
    }

    static getNavRow(target = 'main', ui = null) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const callbacks = {
            main: 'cancel',
            settings: 'settings_back_root',
            settings_ai: 'settings_ai',
            history: 'history_back'
        };
        const labels = {
            main: UiStyleService.backLabel(style),
            settings: UiStyleService.backLabel(style, 'Назад'),
            settings_ai: UiStyleService.backLabel(style, 'Назад'),
            history: UiStyleService.backLabel(style, 'Назад')
        };
        return [[{
            text: labels[target] || UiStyleService.backLabel(style),
            callback_data: callbacks[target] || 'cancel'
        }]];
    }

    static withNav(menu, target = 'main', ui = null) {
        const keyboard = menu?.reply_markup?.inline_keyboard
            ? [...menu.reply_markup.inline_keyboard]
            : [];
        const backData = this.getNavRow(target, ui)[0][0].callback_data;
        const hasBack = keyboard.some((row) => row.some((btn) => btn.callback_data === backData));
        if (!hasBack) keyboard.push(this.getNavRow(target, ui)[0]);
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static async getReplyMenuKeyboard(ui = null) {
        ui = await this._ui(ui);
        const UiStyleService = require('./UiStyleService');
        return {
            keyboard: [[{ text: UiStyleService.replyMenuLabel(ui) }]],
            resize_keyboard: true,
            is_persistent: true
        };
    }

    static async getReplyMenuLabels(ui = null) {
        ui = await this._ui(ui);
        const UiStyleService = require('./UiStyleService');
        const labels = ['Главное меню', UiStyleService.replyMenuLabel(ui)];
        if (UiStyleService.usesEmojis(ui)) labels.push('▶️ Меню');
        return labels;
    }

    static getCancelConfirmMenu({ saveKind, ui } = {}) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const rows = [];
        if (saveKind === 'wizard' || saveKind === 'post') {
            rows.push([{
                text: UiStyleService.optionalEmoji(style, '💾', 'Сохранить в черновики'),
                callback_data: 'cancel_save'
            }]);
        }
        rows.push(
            [{ text: UiStyleService.optionalEmoji(style, '↩️', 'Продолжить'), callback_data: 'cancel_stay' }],
            [{ text: UiStyleService.optionalEmoji(style, '🗑', 'Выйти без сохранения'), callback_data: 'cancel_discard' }]
        );
        return { reply_markup: { inline_keyboard: rows } };
    }

    static getWizardStepsMenu(currentMode, wizard = null, ui = null) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const { WIZARD_FLOW, WIZARD_STEP_LABELS } = require('../constants/wizardSteps');
        const WritingService = require('./WritingService');
        const cur = UiStyleService.usesEmojis(style) ? '▶ ' : '• ';
        const rows = WIZARD_FLOW.map((mode) => {
            const prefix = mode === currentMode ? cur : '';
            const done = wizard && WritingService.isStepFilled(mode, wizard)
                ? UiStyleService.selectedMark(style)
                : '';
            return [{ text: `${prefix}${done}${WIZARD_STEP_LABELS[mode]}`, callback_data: `wizard_goto_${mode}` }];
        });
        if (currentMode === 'wizard_review' || currentMode === 'wizard_edit' || currentMode === 'wizard_generate_error') {
            rows.push([{ text: this._L(style, '▶', 'Предпросмотр'), callback_data: 'wizard_goto_review' }]);
        }
        const close = UiStyleService.navLabel(style, 'back').replace('Назад', 'Закрыть');
        rows.push([{ text: close, callback_data: 'wizard_steps_close' }]);
        return { reply_markup: { inline_keyboard: rows } };
    }

    static getWizardStepMenu(skipCallback, mode, { filled = false, ui = null } = {}) {
        const UiStyleService = require('./UiStyleService');
        return UiStyleService.buildWizardKeyboard(ui, mode, { filled, skipCallback });
    }

    static getWizardLanguageMenu(mode = 'wizard_language', { filled = false, editing = false, ui = null } = {}) {
        const UiStyleService = require('./UiStyleService');
        const extra = [];
        if (!filled || editing) {
            extra.push(
                [{ text: UiStyleService.languagePresetLabel(ui, 'ru', 'Только русский'), callback_data: 'wizard_lang_ru' }],
                [{ text: UiStyleService.languagePresetLabel(ui, 'proper', 'Только имена (люди, места)'), callback_data: 'wizard_lang_proper' }],
                [{ text: UiStyleService.languagePresetLabel(ui, 'names', 'Бренды и названия'), callback_data: 'wizard_lang_names' }],
                [{ text: UiStyleService.languagePresetLabel(ui, 'topic', 'По теме — уместные термины'), callback_data: 'wizard_lang_topic' }],
                [{ text: UiStyleService.languagePresetLabel(ui, 'en', 'Можно много английского'), callback_data: 'wizard_lang_en' }]
            );
        }
        return UiStyleService.buildWizardKeyboard(
            ui,
            mode,
            { filled: filled && !editing, editing, skipCallback: 'wizard_skip_language' },
            extra
        );
    }

    static getWizardStyleMenu(mode = 'wizard_style', { filled = false, editing = false, ui = null, wizard = null } = {}) {
        const UiStyleService = require('./UiStyleService');
        const extra = [];
        if (!filled || editing) {
            const selected = new Set(wizard?.postStyles || []);
            if (wizard?.postStyle && wizard.postStyle !== 'custom') selected.add(wizard.postStyle);
            const presets = [
                ['wizard_style_short', 'short', '⚡', 'Короткий'],
                ['wizard_style_story', 'story', '📖', 'История'],
                ['wizard_style_facts', 'facts', '📋', 'Факты и тезисы'],
                ['wizard_style_expert', 'expert', '🎓', 'Экспертный разбор'],
                ['wizard_style_casual', 'casual', '💬', 'Разговорный']
            ];
            for (const [cb, id, emoji, text] of presets) {
                const mark = selected.has(id) ? UiStyleService.selectedMark(ui) : '';
                extra.push([{
                    text: mark + UiStyleService.stylePresetLabel(ui, emoji, text),
                    callback_data: cb
                }]);
            }
        }
        const stylePending = Boolean(
            !filled &&
            !editing &&
            (wizard?.postStyles?.length || wizard?.postStyleNote?.trim() || (wizard?.postStyle && wizard.postStyle !== 'custom'))
        );
        return UiStyleService.buildWizardKeyboard(
            ui,
            mode,
            { filled: filled && !editing, editing, skipCallback: 'wizard_skip_style', stylePending },
            extra
        );
    }

    static getWizardMediaGalleryMenu(skipCallback, { wizard = null, mode = 'wizard_media', filled = false, editing = false, ui = null, page = 0 } = {}) {
        const UiStyleService = require('./UiStyleService');
        const MediaLib = require('./WizardMediaLibrary');
        MediaLib.migrateLegacyMedia(wizard);
        const extra = [];
        const { page: safePage, pageCount, items, start } = MediaLib.getGalleryPage(wizard || {}, page);

        if (items.length) {
            let selectRow = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const num = start + i + 1;
                const selected = wizard?.selectedMediaIds?.includes(item.id);
                selectRow.push({
                    text: `${selected ? '✓' : '·'} ${num}`,
                    callback_data: `wizard_media_toggle_${item.id}`
                });
                if (selectRow.length === 4) {
                    extra.push([...selectRow]);
                    selectRow = [];
                }
            }
            if (selectRow.length) extra.push(selectRow);

            let delRow = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                delRow.push({
                    text: this._L(ui, '🗑', String(start + i + 1)),
                    callback_data: `wizard_media_rm_${item.id}`
                });
                if (delRow.length === 4) {
                    extra.push([...delRow]);
                    delRow = [];
                }
            }
            if (delRow.length) extra.push(delRow);

            if (pageCount > 1) {
                const navRow = [];
                if (safePage > 0) {
                    navRow.push({ text: '◀', callback_data: `wizard_media_page_${safePage - 1}` });
                }
                navRow.push({ text: `${safePage + 1}/${pageCount}`, callback_data: 'wizard_media_page_noop' });
                if (safePage < pageCount - 1) {
                    navRow.push({ text: '▶', callback_data: `wizard_media_page_${safePage + 1}` });
                }
                extra.push(navRow);
            }
        }

        const poolTotal = wizard?.mediaPool?.length || 0;
        return UiStyleService.buildWizardKeyboard(ui, mode, {
            filled: filled && !editing,
            editing,
            skipCallback,
            mediaCount: poolTotal
        }, extra);
    }

    static getWizardMediaStepMenu(skipCallback, opts = {}) {
        return this.getWizardMediaGalleryMenu(skipCallback, opts);
    }

    static getWizardReviewMenu({ regenerateDisabled = false, ui = null } = {}) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const rows = [];
        if (!regenerateDisabled) {
            rows.push([{ text: this._L(style, '🔄', 'Перегенерировать'), callback_data: 'wizard_review_regenerate' }]);
        }
        rows.push(
            [{ text: this._L(style, '✅', 'Принять'), callback_data: 'wizard_review_accept' }],
            [{ text: this._L(style, '✏️', 'Редактировать вручную'), callback_data: 'wizard_review_edit' }],
            [{ text: this._L(style, '🖼', 'Заменить медиа'), callback_data: 'wizard_review_replace_media' }],
            [{ text: this._L(style, '📋', 'К шагам'), callback_data: 'wizard_steps' }],
            [{ text: this._L(style, '❌', 'Выйти'), callback_data: 'cancel' }]
        );
        return { reply_markup: { inline_keyboard: rows } };
    }

    static getWizardErrorMenu(ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(style, '🔄', 'Повторить'), callback_data: 'wizard_generate_retry' }],
                    [{ text: this._L(style, '✏️', 'Написать вручную'), callback_data: 'wizard_review_edit' }],
                    [{ text: this._L(style, '📋', 'К шагам'), callback_data: 'wizard_steps' }],
                    [{ text: this._L(style, '❌', 'Выйти'), callback_data: 'cancel' }]
                ]
            }
        };
    }

    static getPostActionMenu(ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(style, '📢', 'Опубликовать сейчас'), callback_data: 'publish_now' }],
                    [{ text: this._L(style, '⏳', 'Позже'), callback_data: 'publish_delay' }],
                    [{ text: this._L(style, '📝', 'В черновики'), callback_data: 'save_draft' }],
                    [{ text: this._L(style, '❌', 'Выйти'), callback_data: 'cancel' }]
                ]
            }
        };
    }

    static getDraftsMenu(drafts, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        const keyboard = drafts.map((d) => {
            if (d.kind === 'wizard') {
                const label = d.label?.length > 28 ? `${d.label.slice(0, 28)}…` : d.label;
                return [{ text: this._L(style, '✨', `Мастер: ${label || 'без названия'}`), callback_data: `draft_wizard_${d.id}` }];
            }
            return [{ text: this._L(style, '✏️', 'Пост'), callback_data: `draft_select_${d.id}` }];
        });
        keyboard.push([{ text: UiStyleService.backLabel(style), callback_data: 'cancel_discard' }]);
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getWizardDraftActionMenu(draftId, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(style, '▶️', 'Продолжить мастер'), callback_data: `draft_wizard_resume_${draftId}` }],
                    [{ text: this._L(style, '❌', 'Удалить'), callback_data: `draft_wizard_delete_${draftId}` }],
                    [{ text: UiStyleService.backLabel(style, 'Назад'), callback_data: 'menu_drafts' }]
                ]
            }
        };
    }

    static getDraftActionMenu(draftId, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(style, '✏️', 'Изменить'), callback_data: `draft_edit_${draftId}` }],
                    [{ text: this._L(style, '📢', 'Опубликовать сейчас'), callback_data: `draft_publish_now_${draftId}` }],
                    [{ text: this._L(style, '⏳', 'Позже'), callback_data: `draft_publish_delay_${draftId}` }],
                    [{ text: this._L(style, '❌', 'Удалить'), callback_data: `draft_delete_${draftId}` }],
                    [{ text: UiStyleService.backLabel(style, 'Отмена'), callback_data: 'draft_cancel' }]
                ]
            }
        };
    }

    static getCalendar(year, month, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const date = new Date(year, month, 1);
        const startDay = date.getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const rows = [];
        let day = 1;
        for (let week = 0; week < 6; week++) {
            const row = [];
            for (let d = 0; d < 7; d++) {
                if (week === 0 && d < startDay) {
                    row.push({ text: ' ', callback_data: 'noop' });
                } else if (day > daysInMonth) {
                    row.push({ text: ' ', callback_data: 'noop' });
                } else {
                    const dayStr = String(day).padStart(2, '0');
                    row.push({
                        text: dayStr,
                        callback_data: `calendar_${year}-${String(month + 1).padStart(2, '0')}-${dayStr}`
                    });
                    day++;
                }
            }
            rows.push(row);
            if (day > daysInMonth) break;
        }
        const prev = new Date(year, month - 1, 1);
        const next = new Date(year, month + 1, 1);
        const nav = [
            { text: '<', callback_data: `calendar_prev_${prev.getFullYear()}-${prev.getMonth()}` },
            { text: `${year}-${String(month + 1).padStart(2, '0')}`, callback_data: 'noop' },
            { text: '>', callback_data: `calendar_next_${next.getFullYear()}-${next.getMonth()}` }
        ];
        rows.unshift(nav);
        rows.push([{ text: this._L(style, '❌', 'Отмена'), callback_data: 'cancel' }]);
        return { reply_markup: { inline_keyboard: rows } };
    }

    static getHistoryFilters(activeFilter, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        const mark = (f, label) => (activeFilter === f ? `${UiStyleService.selectedMark(style)}${label}` : label);
        return {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: mark('published', 'Вышедшие'), callback_data: 'history_filter_published' },
                        { text: mark('scheduled', 'В очереди'), callback_data: 'history_filter_scheduled' }
                    ],
                    [
                        { text: mark('deleted', 'Удалённые'), callback_data: 'history_filter_deleted' },
                        { text: mark('all', 'Все'), callback_data: 'history_filter_all' }
                    ],
                    [{ text: this._L(style, '🔄', 'Сверить с каналом'), callback_data: 'history_sync' }]
                ]
            }
        };
    }

    static getHistoryListMenu(items, page, totalPages, ui = null) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const keyboard = items.map((item) => {
            const cb =
                item.kind === 'scheduled'
                    ? `history_sch_${item.refId}`
                    : `history_pub_${item.refId}`;
            return [{ text: item.buttonLabel, callback_data: cb }];
        });

        const nav = [];
        if (page > 0) nav.push({ text: UiStyleService.usesEmojis(style) ? '◀️' : '◀', callback_data: `history_page_${page - 1}` });
        if (totalPages > 1) nav.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
        if (page < totalPages - 1) nav.push({ text: UiStyleService.usesEmojis(style) ? '▶️' : '▶', callback_data: `history_page_${page + 1}` });
        if (nav.length) keyboard.push(nav);

        keyboard.push([{ text: UiStyleService.backLabel(style), callback_data: 'cancel' }]);
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getScheduledCardMenu(uuid, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: this._L(style, '📢', 'Опубликовать сейчас'), callback_data: `history_sch_now_${uuid}` }],
                    [{ text: this._L(style, '⏳', 'Перенести'), callback_data: `history_sch_reschedule_${uuid}` }],
                    [{ text: this._L(style, '❌', 'Отменить'), callback_data: `history_sch_cancel_${uuid}` }],
                    [{ text: UiStyleService.backLabel(style, 'Назад'), callback_data: 'history_back' }]
                ]
            }
        };
    }

    static getPublishedCardMenu(url, replyContext, ui = null) {
        const style = ui || { useEmojis: true, navStyle: 'text' };
        const UiStyleService = require('./UiStyleService');
        const rows = [];

        if (replyContext?.post?.replyTo) {
            rows.push([{
                text: this._L(style, '↩️', `К посту #${replyContext.post.replyTo}`),
                callback_data: `history_pub_${replyContext.post.replyTo}`
            }]);
        }

        if (replyContext?.children?.length) {
            const childRows = replyContext.children.slice(0, 5).map((c) => ([{
                text: this._L(style, '💬', `Ответ #${c.id}`),
                callback_data: `history_pub_${c.id}`
            }]));
            rows.push(...childRows);
        }

        if (url && replyContext?.post?.lifecycleStatus !== 'deleted') {
            rows.push([{ text: this._L(style, '🔗', 'Открыть в канале'), url }]);
        }

        rows.push([{ text: UiStyleService.backLabel(style, 'Назад'), callback_data: 'history_back' }]);
        return { reply_markup: { inline_keyboard: rows } };
    }

    static getSettingsRootMenu(ui = null) {
        const UiStyleService = require('./UiStyleService');
        const style = ui || { useEmojis: true, navStyle: 'text' };
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: UiStyleService.optionalEmoji(style, '📖', 'Инструкция'), callback_data: 'settings_help' }],
                    [{ text: UiStyleService.optionalEmoji(style, '🤖', 'ИИ для постов'), callback_data: 'settings_ai' }],
                    [{ text: UiStyleService.optionalEmoji(style, '🎨', 'Оформление'), callback_data: 'settings_appearance' }],
                    [{ text: UiStyleService.optionalEmoji(style, '🌍', 'Основные'), callback_data: 'settings_general' }],
                    [{ text: UiStyleService.backLabel(style), callback_data: 'cancel' }]
                ]
            }
        };
    }

    static getSettingsAppearanceMenu(ui) {
        const UiStyleService = require('./UiStyleService');
        const useEmojis = UiStyleService.usesEmojis(ui);
        const navStyle = ui?.navStyle === 'arrows' ? 'arrows' : 'text';
        const sel = (on) => (on ? UiStyleService.selectedMark(ui) : '');
        return {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: useEmojis ? '🔕 Смайлики: выкл' : 'Смайлики: вкл',
                        callback_data: 'settings_ui_toggle_emojis'
                    }],
                    [{
                        text: `${sel(navStyle === 'text')}Навигация: слова`,
                        callback_data: 'settings_ui_nav_text'
                    }],
                    [{
                        text: `${sel(navStyle === 'arrows')}Навигация: стрелки`,
                        callback_data: 'settings_ui_nav_arrows'
                    }],
                    [{ text: UiStyleService.backLabel(ui, 'Назад'), callback_data: 'settings_back_root' }],
                    [{ text: UiStyleService.backLabel(ui), callback_data: 'cancel' }]
                ]
            }
        };
    }

    static getSettingsAiMenu(activeProvider, autoEnrich, configuredIds) {
        const keyboard = [
            [{ text: '🔀 Сменить нейросеть', callback_data: 'settings_ai_pick_list' }],
            [{ text: '➕ Подключить сервис', callback_data: 'settings_ai_add' }],
            [{
                text: autoEnrich ? '🔕 Выключить автоанализ' : '🔔 Включить автоанализ',
                callback_data: 'settings_ai_toggle_enrich'
            }]
        ];

        if (activeProvider && configuredIds.includes(activeProvider)) {
            keyboard.push([{
                text: '🧠 Модель нейросети',
                callback_data: `settings_ai_model_menu_${activeProvider}`
            }]);
            keyboard.push([{
                text: '🗑 Отключить текущий сервис',
                callback_data: `settings_ai_remove_${activeProvider}`
            }]);
        }

        keyboard.push(
            [{ text: '↩️ Назад', callback_data: 'settings_back_root' }],
            [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
        );

        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getSettingsPickProviderMenu(configuredIds, activeProvider) {
        const AiProviderRegistry = require('../ai/AiProviderRegistry');
        const keyboard = configuredIds.map((id) => {
            const mark = id === activeProvider ? '✓ ' : '';
            const label = AiProviderRegistry.getLabel(id);
            return [{ text: `${mark}${label}`, callback_data: `settings_ai_pick_${id}` }];
        });
        keyboard.push(
            [{ text: '↩️ Назад', callback_data: 'settings_ai' }],
            [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
        );
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getSettingsAddProviderMenu() {
        const AiProviderRegistry = require('../ai/AiProviderRegistry');
        const keyboard = AiProviderRegistry.listAll().map((p) => {
            return [{ text: AiProviderRegistry.getLabel(p.id, { withTier: false }), callback_data: `settings_ai_add_${p.id}` }];
        });
        keyboard.push(
            [{ text: '↩️ Назад', callback_data: 'settings_ai' }],
            [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
        );
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getSettingsModelMenu(providerId, presets, currentModel) {
        const keyboard = presets.map((m, idx) => {
            const mark = m === currentModel ? '✓ ' : '';
            return [{ text: `${mark}${m}`, callback_data: `settings_ai_model_set_${providerId}_${idx}` }];
        });
        keyboard.push(
            [{ text: '↩️ Назад', callback_data: 'settings_ai' }],
            [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
        );
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getSettingsGeneralMenu(currentTz, chatCleanup) {
        const presets = ['Europe/Moscow', 'UTC', 'Europe/Kiev', 'Asia/Almaty'];
        const keyboard = [
            [{
                text: chatCleanup ? '🧹 Выключить очистку чата' : '🧹 Включить очистку чата',
                callback_data: 'settings_toggle_cleanup'
            }]
        ];
        presets.forEach((tz) => {
            const mark = tz === currentTz ? '✓ ' : '';
            keyboard.push([{ text: `${mark}${tz}`, callback_data: `settings_tz_${tz}` }]);
        });
        keyboard.push(
            [{ text: '✏️ Ввести часовой пояс вручную', callback_data: 'settings_tz_manual' }],
            [{ text: '↩️ Назад', callback_data: 'settings_back_root' }],
            [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
        );
        return { reply_markup: { inline_keyboard: keyboard } };
    }

    static getSettingsHelpMenu() {
        return {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '↩️ Назад', callback_data: 'settings_back_root' }],
                    [{ text: '↩️ Главное меню', callback_data: 'cancel' }]
                ]
            }
        };
    }
}

module.exports = MenuService;
