const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID, CHANNEL_ID, OWNER_TELEGRAM_ID, STORAGE_BACKEND } = require('../config');
const PostService = require('./PostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const HistoryService = require('./HistoryService');
const ChannelReconcileService = require('./ChannelReconcileService');
const stateManager = require('./StateManager');
const ExistingPosts = require('./ExistingPosts');
const SummaryService = require('./SummaryService');
const ProcessedPosts = require('./ProcessedPosts');
const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const SettingsUIService = require('./SettingsUIService');
const AccessService = require('./AccessService');
const SyncService = require('./SyncService');
const StorageRegistry = require('../storage/StorageRegistry');
const AdminHandlers = require('./AdminHandlers');
const TopicHandlers = require('../handlers/TopicHandlers');
const AdminPanelService = require('./AdminPanelService');
const { t } = require('../i18n');
const ChatCleanupService = require('./ChatCleanupService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const { initChannelUrl, buildPostUrl, resolveChannelDisplay } = require('../utils/channelUrl');
const WritingService = require('./WritingService');
const MediaLib = require('./WizardMediaLibrary');
const UiStyleService = require('./UiStyleService');
const MediaGroupCollector = require('./MediaGroupCollector');
const { extractText, parseMedia } = require('../utils/messageParse');
const { sanitizeTelegramHtml, captionTooLong, CAPTION_MAX } = require('../utils/telegramHtml');
const { summarizeMediaCollection } = require('../utils/telegramMedia');
const { WIZARD_FLOW } = require('../constants/wizardSteps');

const WIZARD_STEP_INFO = {
  wizard_title: {
    skip: 'wizard_skip_title',
    prompt: 'Шаг 1/7. Укажите <b>название или тему</b> поста:'
  },
  wizard_brief: {
    skip: 'wizard_skip_brief',
    prompt: 'Шаг 2/7. Опишите, <b>о чём написать</b> — факты, тезисы:'
  },
  wizard_tone: {
    skip: 'wizard_skip_tone',
    prompt: 'Шаг 3/7. Укажите <b>тон</b> (информативный, короткий, с эмодзи…):'
  },
  wizard_language: {
    skip: 'wizard_skip_language',
    prompt:
      'Шаг 4/7. <b>Язык и иностранные слова</b>\n\n' +
      'Выберите вариант или отправьте свой (например: «без английского», «термины моды на англ.»):'
  },
  wizard_style: {
    skip: 'wizard_skip_style',
    prompt:
      'Шаг 5/7. <b>Особенность поста</b>\n\n' +
      'Формат и структура — выберите один или несколько вариантов, допишите текстом или нажмите «Готово →»:'
  },
  wizard_media: {
    skip: 'wizard_skip_media',
    prompt: null
  },
  wizard_keywords: {
    skip: 'wizard_skip_keywords',
    prompt: 'Шаг 7/7. Укажите <b>ключевые слова или теги</b> для ИИ:'
  }
};

const WIZARD_LANG_PRESETS = {
  wizard_lang_ru: 'ru_only',
  wizard_lang_proper: 'names_proper',
  wizard_lang_names: 'names_only',
  wizard_lang_topic: 'topic_terms',
  wizard_lang_en: 'bilingual'
};

const WIZARD_STYLE_PRESETS = {
  wizard_style_short: 'short',
  wizard_style_story: 'story',
  wizard_style_facts: 'facts',
  wizard_style_expert: 'expert',
  wizard_style_casual: 'casual'
};

const WIZARD_MODES = new Set([
  ...WIZARD_FLOW,
  'wizard_review',
  'wizard_edit',
  'wizard_generate_error'
]);

const WORKFLOW_MODES = new Set([
  ...WIZARD_MODES,
  'waiting_post',
  'choose_post_action',
  'waiting_edit',
  'waiting_date',
  'waiting_time',
  'waiting_ai_secret',
  'waiting_timezone',
  'waiting_access_password',
  'waiting_admin_password',
  'waiting_master_password',
  'waiting_cloud_url',
  'waiting_cloud_key',
  'waiting_custom_ai_label',
  'waiting_custom_ai_url',
  'waiting_custom_ai_key',
  'waiting_custom_ai_model',
  'waiting_invite_custom',
  'waiting_custom_ai_edit_label',
  'waiting_custom_ai_edit_url',
  'waiting_custom_ai_edit_key',
  'waiting_custom_ai_edit_model',
  'topic_choose_count',
  'topic_generating',
  'topic_review',
  'topic_pick_reference'
]);

class BotService {
  constructor(postRepository) {
    this.bot = new TelegramBot(BOT_TOKEN, {
      polling: { interval: 300, autoStart: true, params: { timeout: 10 } }
    });

    this.bot.on('polling_error', (err) => {
      const code = err?.response?.body?.error_code || err?.code;
      const desc = err?.response?.body?.description || err?.message || String(err);
      console.error('polling_error', desc);
      if (code === 409 || /409|Conflict|getUpdates/i.test(desc)) {
        console.error(
          '[BotService] Конфликт токена: бот уже запущен в другом месте. Остановите локальный npm start или второй деплой.'
        );
      }
    });
    this.bot.on('webhook_error', (err) => console.error('webhook_error', err));

    this.postService = new PostService(this.bot);
    this.postRepository = postRepository;
    this.adminHandlers = new AdminHandlers(this);
    this.topicHandlers = new TopicHandlers(this);

    initChannelUrl(this.bot).catch(console.error);

    this.initHandlers();
    this.setupAdminChatUi(Number(OWNER_TELEGRAM_ID || ADMIN_ID)).catch(console.error);
  }

  isAdmin(userId) {
    return AccessService.isAuthorizedSync(userId);
  }

  isOwner(userId) {
    return AccessService.isOwnerSync(userId);
  }

  getUserRole(userId) {
    return AccessService.getRoleSync(userId) || (this.isOwner(userId) ? 'owner' : null);
  }

  async locale(userId) {
    return SettingsService.getLocale();
  }

  async tLoc(key, params, userId) {
    return t(key, params, await this.locale(userId));
  }

  async requireOwner(userId, message = null) {
    if (this.isOwner(userId)) return true;
    const msg = message || (await this.tLoc('menu.owner.only', null, userId));
    await this.sendMessage(userId, msg);
    return false;
  }

  async requireGuestAllowed(userId, message = null, { allowDraftsEdit = false } = {}) {
    if (this.getUserRole(userId) !== 'guest') return true;
    if (allowDraftsEdit) {
      const perms = await SettingsService.getGuestPermissions();
      if (perms.draftsEdit) return true;
    }
    const msg = message || (await this.tLoc('menu.guest.blocked', null, userId));
    await this.sendMessage(userId, msg);
    return false;
  }

  async clearState(userId, { releaseStaging = true, keepPinnedIds = [] } = {}) {
    const state = stateManager.get(userId);
    const keep = new Set((keepPinnedIds || []).filter(Boolean));
    const shouldRelease = (id) => releaseStaging && id && !keep.has(id);

    if (releaseStaging) {
      if (shouldRelease(state?.stagingMessageId)) {
        await ChatCleanupService.releasePinnedMessage(this.bot, userId, state.stagingMessageId);
      }
      if (state?.wizard) {
        if (releaseStaging) {
          await WritingService.releaseWizardSession(this.bot, userId, state.wizard, { clearPool: true });
        } else if (keep.size) {
          for (const id of WritingService.collectWizardMessageIds(state.wizard)) {
            if (!keep.has(id)) {
              await ChatCleanupService.releasePinnedMessage(this.bot, userId, id);
            }
          }
        }
      }
      if (state?.stagingMessageIds?.length) {
        for (const id of state.stagingMessageIds) {
          if (shouldRelease(id) && id !== state?.stagingMessageId) {
            await ChatCleanupService.releasePinnedMessage(this.bot, userId, id);
          }
        }
      }
    }
    MediaGroupCollector.cancelForUser(userId);
    stateManager.clear(userId);
  }

  getCancelSaveKind(state) {
    if (!state) return null;
    if (state.mode === 'choose_post_action' && state.chatId) return 'post';
    if (state.wizard && WritingService.hasWizardInput(state.wizard)) {
      if (WIZARD_MODES.has(state.mode) || state.mode === 'wizard_generating') return 'wizard';
    }
    return null;
  }

  async promptWorkflowExit(userId, state) {
    const saveKind = this.getCancelSaveKind(state);
    if (WORKFLOW_MODES.has(state?.mode) || state?.mode === 'waiting_post') {
      if (saveKind) {
        stateManager.set(userId, { ...state, cancelPrompt: true });
        const text =
          saveKind === 'wizard'
            ? 'Выйти из мастера? Прогресс можно сохранить в черновики.'
            : 'Выйти? Пост можно сохранить в черновики.';
        return this.sendMessage(userId, text, MenuService.getCancelConfirmMenu({ saveKind, ui: await UiStyleService.get() }));
      }
      await this.clearState(userId);
      return this.sendMessage(userId, '❌ Действие отменено', await MenuService.getMainMenu());
    }
    await this.clearState(userId);
    return this.sendMessage(userId, 'Выберите действие:', await MenuService.getMainMenu());
  }

  async restoreWorkflowUi(userId, state) {
    if (!state) {
      return this.sendMessage(userId, await this.tLoc('menu.main.choose', null, userId), await this.getMainMenuFor(userId));
    }
    delete state.cancelPrompt;
    stateManager.set(userId, state);

    if (state.mode === 'wizard_review') {
      return this.showWizardReview(userId, state);
    }
    if (state.mode === 'wizard_generate_error') {
      const ui = await UiStyleService.get();
      return this.sendMessage(userId, 'Продолжайте или выберите действие:', MenuService.getWizardErrorMenu(ui));
    }
    if (state.mode === 'choose_post_action') {
      const ui = await UiStyleService.get();
      return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(ui));
    }
    if (state.mode === 'wizard_edit') {
      return this.sendMessage(
        userId,
        'Отправьте новый текст поста.\n\n' +
          'Можно использовать HTML: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;a href="..."&gt;</code>',
        { parse_mode: 'HTML' }
      );
    }
    if (state.mode === 'waiting_post') {
      return this.sendMessage(userId, 'Отправьте сообщение (текст, фото, видео) для публикации:');
    }
    if (WIZARD_FLOW.includes(state.mode)) {
      return this.showWizardStep(userId, state.mode);
    }
    return this.sendMessage(userId, 'Выберите действие:', await MenuService.getMainMenu());
  }

  async saveWorkflowDraft(userId, state) {
    if (state.mode === 'choose_post_action') {
      await DraftService.add(userId, state.chatId, state.messageId, {
        stagingMessageIds: state.stagingMessageIds,
        stagedMeta: state.stagedMeta,
        previewText: state.previewText,
        media: state.media
      });
      await this.clearState(userId, { releaseStaging: false });
      return this.sendMessage(userId, 'Сохранено в черновики ✅', await MenuService.getMainMenu());
    }

    const pinnedIds = WritingService.getWizardPinnedIds(state.wizard);
    await DraftService.addWizard(userId, {
      label: WritingService.wizardDraftLabel(state.wizard),
      snapshot: {
        mode: state.mode,
        wizard: JSON.parse(JSON.stringify(state.wizard)),
        wizardReplaceMedia: Boolean(state.wizardReplaceMedia),
        wizardStepRevisit: Boolean(state.wizardStepRevisit)
      },
      pinnedMessageIds: pinnedIds
    });
    await this.clearState(userId, { releaseStaging: false, keepPinnedIds: pinnedIds });
    return this.sendMessage(userId, 'Мастер сохранён в черновики ✅', await MenuService.getMainMenu());
  }

  async resumeWizardDraft(userId, draft) {
    const snap = draft.snapshot || {};
    const mode = snap.mode || 'wizard_title';
    const restored = {
      mode,
      wizard: snap.wizard || WritingService.emptyWizard(),
      wizardReplaceMedia: snap.wizardReplaceMedia || false,
      wizardStepRevisit:
        snap.wizardStepRevisit ?? WritingService.isStepFilled(mode, snap.wizard)
    };
    stateManager.set(userId, restored);
    const state = stateManager.get(userId);

    if (state.mode === 'wizard_review' && state.wizard?.bodyHtml) {
      return this.showWizardReview(userId, state);
    }
    if (WIZARD_FLOW.includes(state.mode)) {
      return this.showWizardStep(userId, state.mode);
    }
    state.mode = 'wizard_title';
    stateManager.set(userId, state);
    return this.showWizardStep(userId, 'wizard_title');
  }

  async wizardGoBack(userId, state) {
    if (!state?.wizard) return;
    const prevMode = state.mode;
    if (state.mode === 'wizard_review' || state.mode === 'wizard_edit' || state.mode === 'wizard_generate_error') {
      state.mode = 'wizard_keywords';
    } else {
      const idx = WIZARD_FLOW.indexOf(state.mode);
      if (idx <= 0) return this.showWizardStep(userId, state.mode);
      state.mode = WIZARD_FLOW[idx - 1];
    }
    if (prevMode === 'wizard_media' && state.mode !== 'wizard_media') {
      await WritingService.hideWizardMediaPreview(this.bot, userId, state.wizard);
    }
    delete state.wizardReplaceMedia;
    delete state.wizardStepEditing;
    state.wizardStepRevisit = WritingService.isStepFilled(state.mode, state.wizard);
    stateManager.set(userId, state);
    return this.showWizardStep(userId, state.mode);
  }

  async stageSourceMessage(userId, msg) {
    const copied = await this.bot.copyMessage(userId, msg.chat.id, msg.message_id);
    if (!copied?.message_id) {
      throw new Error('stage_failed');
    }
    ChatCleanupService.pinMessage(userId, copied.message_id);
    return copied.message_id;
  }

  async tryPublish(userId, chatId, messageId, { releaseStagingId, releaseStagingIds, messageIds, stagedMeta } = {}) {
    try {
      const ids = messageIds?.length ? messageIds : null;
      const result = await this.postService.publish(userId, chatId, messageId, {
        messageIds: ids,
        stagedMeta
      });
      const toRelease = releaseStagingIds?.length
        ? releaseStagingIds
        : releaseStagingId
          ? [releaseStagingId]
          : [];
      for (const id of toRelease) {
        await ChatCleanupService.releasePinnedMessage(this.bot, userId, id);
      }
      return { ok: true, result };
    } catch (err) {
      console.error('[BotService] publish failed:', err.message);
      return { ok: false, message: PostService.formatPublishError(err), sourceMissing: PostService.isSourceMissing(err) };
    }
  }

  async releaseDraftSource(userId, draft) {
    if (!draft?.messageId) return;
    await ChatCleanupService.releasePinnedMessage(this.bot, userId, draft.messageId);
  }

  async setupAdminChatUi(userId) {
    if (!this.isAdmin(userId)) return;

    try {
      await this.bot.setMyCommands(
        [
          { command: 'start', description: 'Главное меню' },
          { command: 'settings', description: 'Настройки' },
          { command: 'admin', description: 'Админ-панель' },
          { command: 'stats', description: 'Статистика' },
          { command: 'pinchannel', description: 'Закрепить канал' }
        ],
        { scope: { type: 'chat', chat_id: userId } }
      );
      await this.bot.setChatMenuButton({
        chat_id: userId,
        menu_button: { type: 'commands' }
      });
    } catch (err) {
      console.error('[BotService] setupAdminChatUi failed:', err.message);
    }

    await this.ensureReplyMenuKeyboard(userId);
  }

  async ensureReplyMenuKeyboard(userId, force = false) {
    if (!(await SettingsService.getChatCleanup())) return;
    if (!this.isAdmin(userId)) return;
    if (!force && ChatCleanupService.hasReplyKeyboard(userId)) return;

    try {
      const msg = await this.bot.sendMessage(userId, '—', {
        reply_markup: await MenuService.getReplyMenuKeyboard()
      });
      ChatCleanupService.markReplyKeyboardReady(userId);
      await this.bot.deleteMessage(userId, msg.message_id).catch(() => {});
    } catch (err) {
      console.error('[BotService] ensureReplyMenuKeyboard failed:', err.message);
    }
  }

  async sendMessage(userId, text, options = {}, sendOpts = {}) {
    if (options.append !== undefined) {
      sendOpts = { ...sendOpts, append: options.append };
      delete options.append;
    }
    if (options.noNav !== undefined) {
      sendOpts = { ...sendOpts, noNav: options.noNav };
      delete options.noNav;
    }
    const { append = false, pinned = false, track = true, noNav = false } = sendOpts;
    const cleanup = await SettingsService.getChatCleanup();

    if (!append) {
      await ChatCleanupService.flushBotMessages(this.bot, userId);
      if (cleanup) {
        await this.ensureReplyMenuKeyboard(userId);
      }
    }

    options.reply_markup = options.reply_markup || {};
    if (!noNav && !options.reply_markup.inline_keyboard && !options.reply_markup.keyboard) {
      const ui = await UiStyleService.get();
      options.reply_markup.inline_keyboard = MenuService.getNavRow('main', ui);
    }
    if (options.reply_markup.inline_keyboard && !cleanup) {
      options.reply_markup.remove_keyboard = true;
    } else if (!options.reply_markup.keyboard && !cleanup) {
      options.reply_markup.remove_keyboard = true;
    }

    const msg = await this.bot.sendMessage(userId, text, options);
    if (track) {
      ChatCleanupService.trackBotMessage(userId, msg.message_id, { pinned });
    }
    return msg;
  }

  _guardHandler(name, handler) {
    return (...args) =>
      Promise.resolve(handler.apply(this, args)).catch(async (err) => {
        console.error(`[BotService] ${name}:`, err);
        const target = args[0];
        const chatId = target?.chat?.id || target?.from?.id;
        if (!chatId) return;
        try {
          await this.sendMessage(chatId, '❌ Внутренняя ошибка. Отправьте /start ещё раз.', { noNav: true });
        } catch {
          /* ignore */
        }
      });
  }

  initHandlers() {
    this.bot.onText(/\/start/, this._guardHandler('handleStart', this.handleStart));
    this.bot.onText(/\/pinchannel/, this._guardHandler('handlePinChannel', this.handlePinChannel));
    this.bot.onText(/\/stats/, this._guardHandler('handleStats', this.handleStats));
    this.bot.onText(/\/settings/, this._guardHandler('handleSettings', this.handleSettings));
    this.bot.onText(/\/admin/, this._guardHandler('handleAdmin', this.handleAdmin));
    this.bot.onText(/\/panel/, this._guardHandler('handleAdmin', this.handleAdmin));
    this.bot.on('callback_query', this._guardHandler('handleCallback', this.handleCallback));
    this.bot.on('message', this._guardHandler('handleMessage', this.handleMessage));
    this.bot.on('channel_post', this._guardHandler('handleChannelPost', this.handleChannelPost));
    this.bot.on(
      'edited_channel_post',
      this._guardHandler('handleEditedChannelPost', this.handleEditedChannelPost)
    );
  }

  async handleAdmin(msg) {
    const userId = msg.from.id;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    return this.adminHandlers.promptEntry(userId);
  }

  async handleStart(msg) {
    const userId = msg.from.id;
    const loc = await this.locale(userId);
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    await this.clearState(userId);

    if (String(OWNER_TELEGRAM_ID || ADMIN_ID) === String(userId) && !(await AccessService.isMasterPasswordSet())) {
      await AccessService.bootstrapOwnerSession(userId);
    }

    if (this.isAdmin(userId)) {
      await this.setupAdminChatUi(userId);
      const role = this.getUserRole(userId) || 'owner';
      return this.sendMessage(
        msg.chat.id,
        await this.tLoc('menu.main.choose', null, userId),
        await MenuService.getMainMenu(null, { role, locale: loc })
      );
    }

    stateManager.set(userId, { mode: 'waiting_access_password' });
    return this.sendMessage(userId, t('auth.welcome', null, loc), { parse_mode: 'HTML', noNav: true });
  }

  async handlePinChannel(msg) {
    const userId = msg.from.id;
    if (!this.isAdmin(userId)) return;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);

    const channel = await resolveChannelDisplay(this.bot);
    if (!channel) {
      return this.sendMessage(
        userId,
        'Не удалось получить ссылку на канал. Укажите CHANNEL_ID как @username (например @voidpreshade) в .env.'
      );
    }

    const opts = {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: 'Открыть', url: channel.url }]]
      }
    };
    const m = await this.sendMessage(userId, 'Канал', opts, { pinned: true });
    try {
      await this.bot.pinChatMessage(userId, m.message_id);
    } catch (e) {
      console.error('pin failed', e);
    }
  }

  async getMainMenuFor(userId) {
    const ui = await UiStyleService.get();
    const locale = await this.locale(userId);
    const role = this.getUserRole(userId) === 'guest' ? 'guest' : 'owner';
    return MenuService.getMainMenu(ui, { role, locale });
  }

  async handleCallback(query) {
    const userId = query.from.id;
    if (!this.isAdmin(userId)) return;

    const data = query.data || '';
    if (data === 'noop') {
      this.bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    this.bot.answerCallbackQuery(query.id).catch(() => {});

    const keepKeyboard =
      data.startsWith('history_filter_') ||
      data.startsWith('history_page_') ||
      data === 'history_sync';
    if (query.message && !keepKeyboard) {
      this.bot
        .editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        )
        .catch(() => {});
    }

    const state = stateManager.get(userId);

    if (data === 'cancel') {
      const fromHistory = state?.mode === 'history_view';
      if (WORKFLOW_MODES.has(state?.mode) || state?.mode === 'waiting_post') {
        return this.promptWorkflowExit(userId, state);
      }
      await this.clearState(userId);

      if (fromHistory) {
        return this.sendMessage(userId, '📋 История закрыта. Выберите действие:', await this.getMainMenuFor(userId));
      }
      return this.sendMessage(userId, 'Выберите действие:', await this.getMainMenuFor(userId));
    }

    if (data === 'cancel_stay') {
      if (!state) return;
      return this.restoreWorkflowUi(userId, state);
    }

    if (data === 'cancel_discard') {
      await this.clearState(userId);
      return this.sendMessage(userId, '❌ Действие отменено', await MenuService.getMainMenu());
    }

    if (data === 'cancel_save') {
      if (!state) return;
      return this.saveWorkflowDraft(userId, state);
    }

    if (data === 'menu_start') {
      if (WORKFLOW_MODES.has(state?.mode) || state?.mode === 'waiting_post') {
        return this.promptWorkflowExit(userId, state);
      }
      await this.clearState(userId);
      return this.sendMessage(userId, 'Выберите действие:', await this.getMainMenuFor(userId));
    }

    if (data === 'access_logout') {
      await AccessService.logout(userId);
      await this.clearState(userId);
      const loc = await this.locale(userId);
      stateManager.set(userId, { mode: 'waiting_access_password' });
      return this.sendMessage(userId, t('auth.logout', null, loc), { noNav: true });
    }

    if (data === 'menu_publish') {
      if (!(await this.requireGuestAllowed(userId))) return;
      const loc = await this.locale(userId);
      return this.sendMessage(userId, t('publish.choose', null, loc), await MenuService.getPublishModeMenu(null, loc));
    }

    if (data === 'publish_mode_ready') {
      stateManager.set(userId, { mode: 'waiting_post' });
      return this.sendMessage(userId, 'Отправьте сообщение (текст, фото, видео) для публикации:');
    }

    if (data === 'publish_mode_ai') {
      return this.startAiWizard(userId);
    }

    if (data === 'publish_mode_topics' || data.startsWith('topic_')) {
      const handled = await this.topicHandlers.handleCallback(userId, data);
      if (handled !== null && handled !== undefined) return handled;
    }

    if (data.startsWith('wizard_')) {
      return this.handleWizardCallback(userId, data, state);
    }

    if (data === 'menu_drafts') {
      const drafts = await DraftService.getAll(userId);
      if (drafts.length === 0) {
        return this.sendMessage(userId, 'Черновиков нет.', await MenuService.getMainMenu());
      }
      return this.sendMessage(userId, 'Выберите черновик:', MenuService.getDraftsMenu(drafts, await UiStyleService.get()));
    }

    if (data === 'menu_history' || data.startsWith('history_')) {
      return this.handleHistoryCallback(userId, data, state);
    }

    if (data.startsWith('draft_')) {
      return this.handleDraftCallback(userId, data, state);
    }

    if (data.startsWith('calendar_')) {
      return this.handleCalendarCallback(userId, data, state);
    }

    if (data === 'menu_settings' || data.startsWith('settings_')) {
      return this.handleSettingsCallback(userId, data, query);
    }

    if (data.startsWith('admin_')) {
      if (!(await this.requireOwner(userId))) return;
      return this.adminHandlers.handleCallback(userId, data);
    }

    if (!state?.chatId && !['publish_now', 'publish_delay', 'save_draft'].includes(data)) {
      return;
    }

    switch (data) {
      case 'publish_now': {
        if (!state?.chatId) return;
        const stagingIds = state.stagingMessageIds?.length
          ? state.stagingMessageIds
          : state.stagingMessageId
            ? [state.stagingMessageId]
            : [];
        const publish = await this.tryPublish(userId, state.chatId, state.messageId, {
          messageIds: stagingIds.length > 1 ? stagingIds : undefined,
          stagedMeta: state.stagedMeta,
          releaseStagingIds: stagingIds
        });
        if (!publish.ok) {
          await this.sendMessage(userId, publish.message);
          return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get()));
        }
        await this.sendPublishConfirmation(userId, publish.result);
        await this.clearState(userId);
        break;
      }
      case 'publish_delay': {
        if (!state?.chatId) return;
        const today = new Date();
        stateManager.set(userId, { ...state, mode: 'waiting_date' });
        await this.sendMessage(
          userId,
          'Выберите дату для публикации:',
          MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get())
        );
        break;
      }
      case 'save_draft': {
        if (!state?.chatId) return;
        await DraftService.add(userId, state.chatId, state.messageId, {
          stagingMessageIds: state.stagingMessageIds,
          stagedMeta: state.stagedMeta,
          previewText: state.previewText,
          media: state.media
        });
        await this.sendMessage(userId, 'Сохранено в черновики ✅', await MenuService.getMainMenu());
        await this.clearState(userId, { releaseStaging: false });
        break;
      }
      default:
        break;
    }
  }

  async handleDraftCallback(userId, data, state) {
    const guestMutating =
      /draft_(delete|edit|publish|wizard_delete|wizard_resume)/.test(data) ||
      data === 'draft_publish_now';
    if (guestMutating && !(await this.requireGuestAllowed(userId, null, { allowDraftsEdit: true }))) return;

    const wizardResumeMatch = data.match(/^draft_wizard_resume_(.+)$/);
    if (wizardResumeMatch) {
      const draft = await DraftService.getById(userId, wizardResumeMatch[1]);
      if (!draft || draft.kind !== 'wizard') {
        return this.sendMessage(userId, 'Черновик мастера не найден.', await MenuService.getMainMenu());
      }
      await DraftService.remove(draft.id);
      return this.resumeWizardDraft(userId, draft);
    }

    const wizardDeleteMatch = data.match(/^draft_wizard_delete_(.+)$/);
    if (wizardDeleteMatch) {
      const draft = await DraftService.getById(userId, wizardDeleteMatch[1]);
      if (draft?.pinnedMessageIds?.length) {
        for (const id of draft.pinnedMessageIds) {
          await ChatCleanupService.releasePinnedMessage(this.bot, userId, id);
        }
      }
      await DraftService.remove(wizardDeleteMatch[1]);
      return this.sendMessage(userId, 'Черновик мастера удалён ✅', await MenuService.getMainMenu());
    }

    const wizardSelectMatch = data.match(/^draft_wizard_(.+)$/);
    if (wizardSelectMatch) {
      const draft = await DraftService.getById(userId, wizardSelectMatch[1]);
      if (!draft || draft.kind !== 'wizard') {
        return this.sendMessage(userId, 'Черновик мастера не найден.', await MenuService.getMainMenu());
      }
      return this.sendMessage(
        userId,
        `✨ <b>${draft.label || 'Мастер ИИ'}</b>\n\nПродолжить с сохранённого шага?`,
        { parse_mode: 'HTML', ...MenuService.getWizardDraftActionMenu(draft.id, await UiStyleService.get()) }
      );
    }

    const topicSelectMatch = data.match(/^draft_topic_(.+)$/);
    if (topicSelectMatch) {
      const draft = await DraftService.getById(userId, topicSelectMatch[1]);
      if (!draft || draft.kind !== 'topic' || !draft.topic) {
        return this.sendMessage(userId, 'Черновик темы не найден.', await MenuService.getMainMenu());
      }
      const topic = draft.topic;
      const text =
        `<b>${topic.title}</b>\n${topic.brief}` +
        (topic.angle ? `\n\n💡 ${topic.angle}` : '') +
        (topic.tags?.length ? `\n\n🏷 ${topic.tags.join(', ')}` : '');
      stateManager.set(userId, {
        mode: 'topic_review',
        topics: { items: [topic], selectedIndex: 0, draftId: draft.id }
      });
      return this.sendMessage(userId, text, {
        parse_mode: 'HTML',
        ...(await MenuService.getTopicActionMenu(0, await UiStyleService.get(), await this.locale(userId)))
      });
    }

    if (data === 'draft_cancel') {
      await this.clearState(userId);
      return this.sendMessage(userId, await this.tLoc('menu.main.choose', null, userId), await this.getMainMenuFor(userId));
    }

    const selectMatch = data.match(/^draft_select_(.+)$/);
    if (selectMatch) {
      const draftId = selectMatch[1];
      const draft = await DraftService.getById(userId, draftId);
      if (!draft) {
        return this.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      stateManager.set(userId, {
        mode: 'draft_action',
        draftId,
        chatId: draft.chatId,
        messageId: draft.messageId
      });
      try {
        const copied = await this.bot.copyMessage(userId, draft.chatId, draft.messageId);
        if (copied?.message_id) {
          ChatCleanupService.trackBotMessage(userId, copied.message_id);
        }
      } catch {
        /* preview optional */
      }
      return this.sendMessage(userId, 'Действия с черновиком:', MenuService.getDraftActionMenu(draftId, await UiStyleService.get()));
    }

    const editMatch = data.match(/^draft_edit_(.+)$/);
    if (editMatch) {
      stateManager.set(userId, { mode: 'waiting_edit', draftId: editMatch[1] });
      return this.sendMessage(userId, 'Отправьте новое сообщение для черновика:');
    }

    const deleteMatch = data.match(/^draft_delete_(.+)$/);
    if (deleteMatch) {
      const draft = await DraftService.getById(userId, deleteMatch[1]);
      if (draft) await this.releaseDraftSource(userId, draft);
      await DraftService.remove(deleteMatch[1]);
      await this.clearState(userId);
      return this.sendMessage(userId, 'Черновик удалён ✅', await MenuService.getMainMenu());
    }

    const publishNowMatch = data.match(/^draft_publish_now_(.+)$/);
    if (publishNowMatch) {
      const draft = await DraftService.getById(userId, publishNowMatch[1]);
      if (!draft) {
        return this.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      const publish = await this.tryPublish(userId, draft.chatId, draft.messageId, {
        releaseStagingId: draft.messageId
      });
      if (!publish.ok) {
        await this.sendMessage(userId, publish.message);
        return this.sendMessage(userId, 'Действия с черновиком:', MenuService.getDraftActionMenu(draft.id, await UiStyleService.get()));
      }
      await DraftService.remove(draft.id);
      await this.sendPublishConfirmation(userId, publish.result);
      await this.clearState(userId);
      return;
    }

    const publishDelayMatch = data.match(/^draft_publish_delay_(.+)$/);
    if (publishDelayMatch) {
      const draft = await DraftService.getById(userId, publishDelayMatch[1]);
      if (!draft) {
        return this.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      const today = new Date();
      stateManager.set(userId, {
        mode: 'waiting_date',
        draftId: draft.id,
        chatId: draft.chatId,
        messageId: draft.messageId,
        previewText: '',
        media: null
      });
      return this.sendMessage(
        userId,
        'Выберите дату для публикации:',
        MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get())
      );
    }
  }

  async handleCalendarCallback(userId, data, state) {
    if (!state) return;

    const prevMatch = data.match(/^calendar_prev_(\d+)-(\d+)$/);
    if (prevMatch) {
      const year = parseInt(prevMatch[1], 10);
      const month = parseInt(prevMatch[2], 10);
      return this.sendMessage(userId, 'Выберите дату:', MenuService.getCalendar(year, month, await UiStyleService.get()));
    }

    const nextMatch = data.match(/^calendar_next_(\d+)-(\d+)$/);
    if (nextMatch) {
      const year = parseInt(nextMatch[1], 10);
      const month = parseInt(nextMatch[2], 10);
      return this.sendMessage(userId, 'Выберите дату:', MenuService.getCalendar(year, month, await UiStyleService.get()));
    }

    const dateMatch = data.match(/^calendar_(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      stateManager.set(userId, { ...state, mode: 'waiting_time', date: dateMatch[1] });
      return this.sendMessage(userId, `Дата ${dateMatch[1]}. Укажите время в формате HH:mm (например 14:30):`);
    }
  }

  async handleHistoryCallback(userId, data, state) {
    const guestBlock = async () => this.requireGuestAllowed(userId);
    let filter = state?.historyFilter || 'published';
    let page = state?.historyPage || 0;

    if (data === 'menu_history') {
      filter = 'published';
      page = 0;
    } else if (data === 'history_filter_published') {
      filter = 'published';
      page = 0;
    } else if (data === 'history_filter_scheduled') {
      filter = 'scheduled';
      page = 0;
    } else if (data === 'history_filter_all') {
      filter = 'all';
      page = 0;
    } else if (data === 'history_filter_deleted') {
      filter = 'deleted';
      page = 0;
    } else if (data === 'history_sync') {
      if (!(await guestBlock())) return;
      filter = state?.historyFilter || 'published';
      page = state?.historyPage || 0;
      if (!ChannelReconcileService.canReconcile()) {
        return this.sendMessage(
          userId,
          'Сверка недоступна: нужны <code>TG_API_ID</code>, <code>TG_API_HASH</code> и <code>TG_SESSION</code> в .env.\n\n' +
            '1. <code>npm run gram:login</code>\n' +
            '2. Перезапустите бота\n\n' +
            'Или на сервере: <code>npm run reconcile</code>',
          { parse_mode: 'HTML' }
        );
      }
      await this.sendMessage(userId, '⏳ Сверяю архив с каналом…', {}, { noNav: true });
      try {
        const result = await ChannelReconcileService.reconcileChannel();
        let note = `✅ Сверка завершена.\nПроверено: ${result.checked}`;
        if (result.deleted) note += `\nПомечено удалёнными: ${result.deleted}`;
        else note += '\nРасхождений не найдено.';
        await this.sendMessage(userId, note, { append: true });
      } catch (err) {
        console.error('[BotService] history_sync error:', err.message);
        await this.sendMessage(userId, `❌ ${err.message}`, { append: true });
      }
      stateManager.set(userId, { mode: 'history_view', historyFilter: filter, historyPage: page });
      return this.showHistoryList(userId, filter, page);
    } else if (data === 'history_back') {
      filter = state?.historyFilter || 'published';
      page = state?.historyPage || 0;
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: page
      });
      return this.showHistoryList(userId, filter, page);
    } else if (data.startsWith('history_page_')) {
      page = parseInt(data.replace('history_page_', ''), 10) || 0;
      filter = state?.historyFilter || 'published';
    }

    const pubMatch = data.match(/^history_pub_(\d+)$/);
    if (pubMatch) {
      return this.showPublishedCard(userId, pubMatch[1], state);
    }

    const schMatch = data.match(/^history_sch_([0-9a-f-]+)$/);
    if (schMatch && !data.includes('_cancel_') && !data.includes('_now_') && !data.includes('_reschedule_')) {
      return this.showScheduledCard(userId, schMatch[1], state);
    }

    const cancelMatch = data.match(/^history_sch_cancel_([0-9a-f-]+)$/);
    if (cancelMatch) {
      if (!(await guestBlock())) return;
      await this.postRepository.removeScheduled(cancelMatch[1]);
      await this.sendMessage(userId, 'Запланированный пост отменён ✅');
      filter = state?.historyFilter || 'scheduled';
      page = 0;
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: page
      });
      return this.showHistoryList(userId, filter, page);
    }

    const nowMatch = data.match(/^history_sch_now_([0-9a-f-]+)$/);
    if (nowMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.postRepository.getById(nowMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.sendMessage(userId, 'Пост не найден или уже опубликован.', await MenuService.getMainMenu());
      }
      const publish = await this.tryPublish(userId, scheduled.chatId, scheduled.messageId, {
        releaseStagingId: scheduled.messageId
      });
      if (!publish.ok) {
        await this.postRepository.markAsFailed(scheduled.id, publish.message);
        if (publish.sourceMissing) {
          await ChatCleanupService.releasePinnedMessage(this.bot, userId, scheduled.messageId);
        }
        await this.sendMessage(userId, publish.message, await MenuService.getMainMenu());
        return;
      }
      await this.postRepository.markAsPublished(scheduled.id);
      await this.sendPublishConfirmation(userId, publish.result);
      filter = state?.historyFilter || 'scheduled';
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: 0
      });
      return this.showHistoryList(userId, filter, 0);
    }

    const rescheduleMatch = data.match(/^history_sch_reschedule_([0-9a-f-]+)$/);
    if (rescheduleMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.postRepository.getById(rescheduleMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
      }
      const today = new Date();
      stateManager.set(userId, {
        mode: 'waiting_date',
        scheduledId: scheduled.id,
        chatId: scheduled.chatId,
        messageId: scheduled.messageId,
        previewText: scheduled.preview || '',
        media: scheduled.media || null,
        historyFilter: state?.historyFilter || 'scheduled',
        historyPage: state?.historyPage || 0
      });
      return this.sendMessage(
        userId,
        'Выберите новую дату публикации:',
        MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get())
      );
    }

    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: filter,
      historyPage: page
    });
    return this.showHistoryList(userId, filter, page);
  }

  async showHistoryList(userId, filter, page) {
    const ui = await UiStyleService.get();
    const result = await HistoryService.list({ filter, page });
    const header = HistoryService.formatListHeader(result);

    await this.sendMessage(userId, header, {
      parse_mode: 'HTML',
      ...MenuService.getHistoryFilters(filter, ui)
    });

    if (result.total === 0) {
      return this.sendMessage(userId, 'Выберите действие:', await MenuService.getMainMenu(), { append: true });
    }

    return this.sendMessage(
      userId,
      'Выберите пост:',
      MenuService.getHistoryListMenu(result.items, result.page, result.pages, ui),
      { append: true }
    );
  }

  async showPublishedCard(userId, refId, state) {
    const item = await HistoryService.getItem({ kind: 'published', refId });
    if (!item) {
      return this.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
    }

    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: state?.historyFilter || 'published',
      historyPage: state?.historyPage || 0
    });

    return this.sendMessage(userId, await HistoryService.formatPublishedCard(item), {
      parse_mode: 'HTML',
      ...MenuService.getPublishedCardMenu(item.channelUrl, item.replyContext, await UiStyleService.get())
    });
  }

  async showScheduledCard(userId, refId, state) {
    const item = await HistoryService.getItem({ kind: 'scheduled', refId });
    if (!item) {
      return this.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
    }

    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: state?.historyFilter || 'scheduled',
      historyPage: state?.historyPage || 0
    });

    return this.sendMessage(userId, await HistoryService.formatScheduledCard(item), {
      parse_mode: 'HTML',
      ...MenuService.getScheduledCardMenu(item.refId, await UiStyleService.get())
    });
  }

  async handleSettings(msg) {
    if (!this.isAdmin(msg.from.id)) return;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    await this.clearState(msg.from.id);
    return this.showSettingsRoot(msg.from.id);
  }

  async showSettingsRoot(userId) {
    const ui = await UiStyleService.get();
    const locale = await this.locale(userId);
    const text = await SettingsUIService.formatSettingsRoot();
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsRootMenu(ui, locale))
    });
  }

  async showSettingsAppearance(userId) {
    const ui = await UiStyleService.get();
    const text = await SettingsUIService.formatAppearanceScreen(ui);
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...MenuService.getSettingsAppearanceMenu(ui)
    });
  }

  async showSettingsAi(userId) {
    const active = await SettingsService.getActiveProvider();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const configuredIds = await SettingsUIService.getConfiguredProviderIds();
    const locale = await this.locale(userId);
    const text = await SettingsUIService.formatAiScreen();
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsAiMenu(active, autoEnrich, configuredIds, locale))
    });
  }

  async showSettingsGeneral(userId) {
    const tz = await SettingsService.getTimezone();
    const chatCleanup = await SettingsService.getChatCleanup();
    const locale = await this.locale(userId);
    const text = await SettingsUIService.formatGeneralScreen();
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsGeneralMenu(tz, chatCleanup, locale))
    });
  }

  async showSettingsCloud(userId) {
    return this.adminHandlers.showCloud(userId);
  }

  async showSettingsAccess(userId) {
    return this.adminHandlers.showAccess(userId);
  }

  async showSettingsHelp(userId) {
    const text = await SettingsUIService.formatHelpScreen(await this.locale(userId));
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...MenuService.getSettingsHelpMenu()
    });
  }

  async handleSettingsCallback(userId, data, query) {
    const guestAllowed =
      data === 'menu_settings' ||
      data === 'settings_back_root' ||
      data === 'settings_general' ||
      data === 'settings_appearance' ||
      data === 'settings_ui_toggle_emojis' ||
      data === 'settings_ui_nav_text' ||
      data === 'settings_ui_nav_arrows' ||
      data === 'settings_help' ||
      data === 'settings_language' ||
      data === 'settings_lang_ru' ||
      data === 'settings_lang_en' ||
      data === 'settings_toggle_cleanup' ||
      data === 'settings_tz_manual' ||
      /^settings_tz_/.test(data);

    if (!guestAllowed && !(await this.requireOwner(userId))) return;
    if (guestAllowed && this.getUserRole(userId) === 'guest' && (data === 'settings_ai' || data.startsWith('settings_ai_'))) {
      return this.requireOwner(userId);
    }

    if (data === 'menu_settings' || data === 'settings_back_root') {
      await this.clearState(userId);
      return this.showSettingsRoot(userId);
    }

    if (data === 'settings_ai') {
      await this.clearState(userId);
      return this.showSettingsAi(userId);
    }

    if (data === 'settings_general') {
      await this.clearState(userId);
      return this.showSettingsGeneral(userId);
    }

    if (data === 'settings_appearance') {
      await this.clearState(userId);
      return this.showSettingsAppearance(userId);
    }

    if (data === 'settings_ui_toggle_emojis') {
      const ui = await SettingsService.getUiStyle();
      await SettingsService.setUiStyle({ useEmojis: !ui.useEmojis });
      ChatCleanupService.clearReplyKeyboard(userId);
      await this.ensureReplyMenuKeyboard(userId, true);
      return this.showSettingsAppearance(userId);
    }

    if (data === 'settings_ui_nav_text') {
      await SettingsService.setUiStyle({ navStyle: 'text' });
      return this.showSettingsAppearance(userId);
    }

    if (data === 'settings_ui_nav_arrows') {
      await SettingsService.setUiStyle({ navStyle: 'arrows' });
      return this.showSettingsAppearance(userId);
    }

    if (data === 'settings_help') {
      await this.clearState(userId);
      return this.showSettingsHelp(userId);
    }

    if (data === 'settings_language') {
      const loc = await SettingsService.getLocale();
      return this.sendMessage(
        userId,
        `<b>${t('settings.language', null, loc)}</b>`,
        { parse_mode: 'HTML', ...(await MenuService.getSettingsLanguageMenu(loc, loc)) }
      );
    }

    if (data === 'settings_lang_ru' || data === 'settings_lang_en') {
      const newLoc = data === 'settings_lang_en' ? 'en' : 'ru';
      await SettingsService.setLocale(newLoc);
      const label = t(newLoc === 'en' ? 'settings.lang.en' : 'settings.lang.ru', null, newLoc);
      await this.sendMessage(userId, t('settings.lang.changed', { lang: label }, newLoc));
      return this.showSettingsGeneral(userId);
    }

    if (data === 'settings_ai_custom_start') {
      stateManager.set(userId, { mode: 'waiting_custom_ai_label', customAi: {} });
      const loc = await this.locale(userId);
      return this.sendMessage(userId, t('settings.ai.custom.label_prompt', null, loc));
    }

    if (data === 'settings_ai_custom_manage') {
      const loc = await this.locale(userId);
      const providers = await SettingsService.getCustomProviders();
      if (!providers.length) {
        return this.sendMessage(userId, t('settings.ai.custom.label_prompt', null, loc));
      }
      return this.sendMessage(
        userId,
        '✏️ ' + t('settings.ai.custom.edit', null, loc),
        await MenuService.getSettingsCustomAiManageMenu(loc)
      );
    }

    const customEditMatch = data.match(/^settings_ai_custom_edit_(.+)$/);
    if (customEditMatch) {
      const provider = await SettingsService.getCustomProvider(customEditMatch[1]);
      if (!provider) return this.showSettingsAi(userId);
      const loc = await this.locale(userId);
      return this.sendMessage(
        userId,
        `<b>${provider.label}</b>\n${provider.baseUrl}`,
        { parse_mode: 'HTML', ...(await MenuService.getSettingsCustomAiEditMenu(provider.id, loc)) }
      );
    }

    const editFieldMatch = data.match(/^settings_ai_edit_(.+)_(label|url|key|model)$/);
    if (editFieldMatch) {
      const [, providerId, field] = editFieldMatch;
      const provider = await SettingsService.getCustomProvider(providerId);
      if (!provider) return this.showSettingsAi(userId);
      const loc = await this.locale(userId);
      const modeMap = {
        label: 'waiting_custom_ai_edit_label',
        url: 'waiting_custom_ai_edit_url',
        key: 'waiting_custom_ai_edit_key',
        model: 'waiting_custom_ai_edit_model'
      };
      stateManager.set(userId, { mode: modeMap[field], customAiEdit: { providerId } });
      const promptKey = {
        label: 'settings.ai.custom.label_prompt',
        url: 'settings.ai.custom.url_prompt',
        key: 'settings.ai.custom.key_prompt',
        model: 'settings.ai.custom.model_prompt'
      }[field];
      return this.sendMessage(userId, t(promptKey, null, loc));
    }

    if (data === 'settings_toggle_cleanup') {
      const current = await SettingsService.getChatCleanup();
      await SettingsService.setChatCleanup(!current);
      return this.showSettingsGeneral(userId);
    }

    if (data === 'settings_ai_toggle_enrich') {
      const current = await SettingsService.getAutoEnrich();
      await SettingsService.setAutoEnrich(!current);
      return this.showSettingsAi(userId);
    }

    if (data === 'settings_ai_pick_list') {
      const configuredIds = await SettingsUIService.getConfiguredProviderIds();
      if (configuredIds.length === 0) {
        return this.sendMessage(userId, 'Сначала подключите сервис в разделе «Подключить сервис».', await MenuService.getSettingsAddProviderMenu());
      }
      const active = await SettingsService.getActiveProvider();
      return this.sendMessage(
        userId,
        'Выберите активную нейросеть:',
        MenuService.getSettingsPickProviderMenu(configuredIds, active)
      );
    }

    if (data === 'settings_ai_add') {
      return this.sendMessage(userId, 'Какой сервис подключить?', await MenuService.getSettingsAddProviderMenu());
    }

    const pickMatch = data.match(/^settings_ai_pick_(.+)$/);
    if (pickMatch && pickMatch[1] !== 'list') {
      await SettingsService.setActiveProvider(pickMatch[1]);
      await this.sendMessage(userId, `Активна нейросеть: <b>${AiProviderRegistry.getLabel(pickMatch[1])}</b>`, { parse_mode: 'HTML' });
      return this.showSettingsAi(userId);
    }

    const addMatch = data.match(/^settings_ai_add_(.+)$/);
    if (addMatch) {
      const providerId = addMatch[1];
      const provider = AiProviderRegistry.get(providerId);
      if (!provider) return;

      const field = provider.secretFields[0];
      stateManager.set(userId, {
        mode: 'waiting_ai_secret',
        providerId,
        secretField: field.key
      });

      const hint = field.key === 'baseUrl'
        ? 'адрес сервера Ollama (например http://127.0.0.1:11434)'
        : `ключ API (${field.placeholder || ''})`;

      return this.sendMessage(
        userId,
        `Отправьте ${hint} для <b>${provider.label}</b>.\n\nСообщение с ключом будет удалено после проверки.`,
        { parse_mode: 'HTML' }
      );
    }

    const removeMatch = data.match(/^settings_ai_remove_(.+)$/);
    if (removeMatch) {
      const providerId = removeMatch[1];
      const wasCustom = AiProviderRegistry.isCustom(providerId);
      await SecretsService.removeProviderSecret(providerId);
      if (wasCustom) {
        await SettingsService.removeCustomProvider(providerId);
        await AiProviderRegistry.refreshCustom();
      }
      const active = await SettingsService.getActiveProvider();
      if (active === providerId) {
        await SettingsService.setActiveProvider(null);
      }
      const loc = await this.locale(userId);
      const msg = wasCustom ? t('settings.ai.custom.removed', null, loc) : 'Сервис отключён';
      await this.sendMessage(userId, msg + ' ✅');
      return this.showSettingsAi(userId);
    }

    const modelMenuMatch = data.match(/^settings_ai_model_menu_(.+)$/);
    if (modelMenuMatch) {
      const providerId = modelMenuMatch[1];
      const provider = AiProviderRegistry.get(providerId);
      if (!provider) return;
      const currentModel = (await SettingsService.getModel(providerId)) || provider.defaultModel;
      return this.sendMessage(
        userId,
        `Модель для ${provider.label}:`,
        MenuService.getSettingsModelMenu(providerId, provider.modelPresets, currentModel)
      );
    }

    const modelSetMatch = data.match(/^settings_ai_model_set_(.+)_(\d+)$/);
    if (modelSetMatch) {
      const providerId = modelSetMatch[1];
      const idx = parseInt(modelSetMatch[2], 10);
      const provider = AiProviderRegistry.get(providerId);
      if (!provider || !provider.modelPresets[idx]) return;
      await SettingsService.setModel(providerId, provider.modelPresets[idx]);
      return this.showSettingsAi(userId);
    }

    if (data === 'settings_tz_manual') {
      stateManager.set(userId, { mode: 'waiting_timezone', settingsReturn: 'general' });
      return this.sendMessage(userId, 'Введите часовой пояс (например Europe/Moscow или UTC):');
    }

    const tzMatch = data.match(/^settings_tz_(.+)$/);
    if (tzMatch && tzMatch[1] !== 'manual') {
      await SettingsService.setTimezone(tzMatch[1]);
      await this.sendMessage(userId, `Часовой пояс: ${tzMatch[1]} ✅`);
      return this.showSettingsGeneral(userId);
    }

    return this.showSettingsRoot(userId);
  }

  async handleMessage(msg) {
    const userId = msg.from.id;
    let state = stateManager.get(userId);

    if (state?.mode === 'waiting_access_password') {
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      const loc = await this.locale(userId);
      const password = msg.text?.trim();
      if (!password) {
        return this.sendMessage(userId, t('auth.invalid', null, loc), { noNav: true });
      }
      const result = await AccessService.authenticate(userId, password);
      if (!result.ok) {
        const errKey = result.error === 'rate_limited' ? 'auth.rate_limited' : 'auth.invalid';
        return this.sendMessage(userId, '❌ ' + t(errKey, null, loc), { noNav: true });
      }
      await this.clearState(userId);
      await this.setupAdminChatUi(userId);
      const roleLabel = t(result.role === 'owner' ? 'auth.role.owner' : 'auth.role.guest', null, loc);
      await this.sendMessage(
        userId,
        '✅ ' + t('auth.success', { role: roleLabel }, loc),
        await this.getMainMenuFor(userId)
      );
      return;
    }

    if (state?.mode === 'waiting_admin_password') {
      return this.adminHandlers.handleAdminPassword(userId, msg, state);
    }

    if (state?.mode === 'waiting_invite_custom') {
      if (!(await this.adminHandlers.requireSession(userId))) return;
      return this.adminHandlers.handleInviteCustom(userId, msg, state);
    }

    if (!this.isAdmin(userId)) return;

    if (msg.text && (await MenuService.getReplyMenuLabels()).includes(msg.text)) {
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      const menuState = stateManager.get(userId);
      if (menuState && (WORKFLOW_MODES.has(menuState.mode) || menuState.mode === 'waiting_post')) {
        return this.promptWorkflowExit(userId, menuState);
      }
      await this.clearState(userId);
      return this.sendMessage(userId, await this.tLoc('menu.main.choose', null, userId), await this.getMainMenuFor(userId));
    }

    if (msg.text?.startsWith('/')) return;

    state = stateManager.get(userId);
    if (!state) return;

    const preserveUserMessage =
      state.mode === 'waiting_post' ||
      state.mode === 'waiting_edit' ||
      WIZARD_FLOW.includes(state.mode) ||
      state.mode === 'wizard_edit';
    if (!preserveUserMessage) {
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
    }

    if (state.preview) {
      delete state.preview;
      stateManager.set(userId, state);
    }

    if (state.mode === 'waiting_post') {
      let stagedId;
      try {
        stagedId = await this.stageSourceMessage(userId, msg);
      } catch {
        return this.sendMessage(
          userId,
          'Не удалось сохранить пост. Попробуйте отправить ещё раз (текст, фото или видео).'
        );
      }
      await ChatCleanupService.consumeUserMessage(this.bot, msg);

      stateManager.set(userId, {
        mode: 'choose_post_action',
        chatId: userId,
        messageId: stagedId,
        stagingMessageId: stagedId,
        previewText: extractText(msg),
        media: parseMedia(msg)
      });
      return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get()));
    }

    if (state.mode === 'waiting_edit') {
      let stagedId;
      try {
        stagedId = await this.stageSourceMessage(userId, msg);
      } catch {
        return this.sendMessage(userId, 'Не удалось обновить черновик. Отправьте сообщение ещё раз.');
      }
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      const oldDraft = await DraftService.getById(userId, state.draftId);
      if (oldDraft) await this.releaseDraftSource(userId, oldDraft);
      await DraftService.update(state.draftId, userId, userId, stagedId);
      await this.sendMessage(userId, 'Черновик обновлён ✅', await MenuService.getMainMenu());
      await this.clearState(userId, { releaseStaging: false });
      return;
    }

    if (state.mode === 'wizard_title') {
      return this.handleWizardTextStep(userId, msg, state, 'title');
    }
    if (state.mode === 'wizard_brief') {
      return this.handleWizardTextStep(userId, msg, state, 'brief');
    }
    if (state.mode === 'wizard_tone') {
      return this.handleWizardTextStep(userId, msg, state, 'tone');
    }
    if (state.mode === 'wizard_language') {
      return this.handleWizardLanguageStep(userId, msg, state);
    }
    if (state.mode === 'wizard_style') {
      return this.handleWizardStyleStep(userId, msg, state);
    }
    if (state.mode === 'wizard_keywords') {
      return this.handleWizardTextStep(userId, msg, state, 'keywords');
    }
    if (state.mode === 'wizard_media') {
      if (this.isWizardStepAwaitingChoice(state)) {
        if (WritingService.isMediaMessage(msg)) {
          return this.sendMessage(userId, 'Используйте кнопки навигации: «Изменить», «Далее →» или «К шагам».');
        }
        if (msg.text?.trim()) {
          return this.sendMessage(userId, 'Используйте кнопки навигации: «Изменить», «Далее →» или «К шагам».');
        }
        return;
      }
      if (WritingService.isMediaMessage(msg)) {
        if (msg.media_group_id) {
          MediaGroupCollector.push(userId, msg, async (msgs) => {
            const current = stateManager.get(userId);
            if (current?.mode !== 'wizard_media') return;
            await this.addWizardMediaMessages(userId, msgs, current);
          });
          return;
        }
        return this.addWizardMediaMessages(userId, [msg], state);
      }
      if (msg.text?.trim()) {
        return this.sendMessage(
          userId,
          'Отправьте медиа (фото, видео, документ…) или нажмите «Пропустить» / «Готово».'
        );
      }
      return;
    }
    if (state.mode === 'wizard_edit') {
      if (WritingService.isMediaMessage(msg)) {
        return this.sendMessage(userId, 'Сейчас нужен текст. Медиа можно заменить на экране предпросмотра.');
      }
      return this.handleWizardEditStep(userId, msg, state);
    }
    if (WIZARD_FLOW.includes(state.mode) && WritingService.isMediaMessage(msg)) {
      return this.sendMessage(userId, 'Сначала завершите этот шаг. Медиа — на шаге 6/7.');
    }

    if (state.mode === 'waiting_date') {
      return this.sendMessage(userId, 'Пожалуйста, выберите дату нажатием на клавиатуру.');
    }

    if (state.mode === 'waiting_master_password') {
      const loc = await this.locale(userId);
      const value = msg.text?.trim();
      if (!value || value.length < 6) {
        return this.sendMessage(userId, t('admin.prompt.set_password', null, loc));
      }
      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      await AccessService.setMasterPassword(value);
      const adminReturn = state.adminReturn;
      await this.clearState(userId);
      AdminPanelService.grant(userId);
      await this.sendMessage(userId, '✅ ' + t('admin.access.password_saved', null, loc));
      if (adminReturn === 'access') return this.adminHandlers.showAccess(userId);
      return this.adminHandlers.showHub(userId);
    }

    if (state.mode === 'waiting_cloud_url') {
      const loc = await this.locale(userId);
      const url = msg.text?.trim();
      if (!url || !/^https:\/\/.+\.supabase\.co\/?$/i.test(url)) {
        return this.sendMessage(userId, t('admin.cloud.url_prompt', null, loc));
      }
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      await SecretsService.setSupabaseConfig({ url: url.replace(/\/$/, '') });
      await SettingsService.setCloud({ supabaseUrl: url.replace(/\/$/, '') });
      const adminReturn = state.adminReturn;
      await this.clearState(userId);
      await this.sendMessage(userId, '✅ ' + t('admin.cloud.url_saved', null, loc));
      if (adminReturn) return this.adminHandlers.showCloud(userId);
      return this.adminHandlers.showCloud(userId);
    }

    if (state.mode === 'waiting_cloud_key') {
      const loc = await this.locale(userId);
      const key = msg.text?.trim();
      if (!key || key.length < 20) {
        return this.sendMessage(userId, t('admin.cloud.key_prompt', null, loc));
      }
      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      await SecretsService.setSupabaseConfig({ serviceKey: key });
      StorageRegistry.reset();
      await this.clearState(userId);
      await this.sendMessage(userId, '✅ ' + t('admin.cloud.key_saved', null, loc));
      return this.adminHandlers.showCloud(userId);
    }

    if (state.mode === 'waiting_custom_ai_label') {
      const loc = await this.locale(userId);
      const label = msg.text?.trim();
      if (!label) return this.sendMessage(userId, t('settings.ai.custom.label_prompt', null, loc));
      state.customAi = { label };
      state.mode = 'waiting_custom_ai_url';
      stateManager.set(userId, state);
      return this.sendMessage(userId, t('settings.ai.custom.url_prompt', null, loc));
    }

    if (state.mode === 'waiting_custom_ai_url') {
      const loc = await this.locale(userId);
      const baseUrl = msg.text?.trim();
      if (!baseUrl || !/^https?:\/\/.+/i.test(baseUrl)) {
        return this.sendMessage(userId, t('settings.ai.custom.url_prompt', null, loc));
      }
      state.customAi.baseUrl = baseUrl;
      state.mode = 'waiting_custom_ai_key';
      stateManager.set(userId, state);
      return this.sendMessage(userId, t('settings.ai.custom.key_prompt', null, loc));
    }

    if (state.mode === 'waiting_custom_ai_key') {
      const loc = await this.locale(userId);
      let key = msg.text?.trim();
      if (key === '-') key = '';
      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      state.customAi.apiKey = key;
      state.customAi.requiresKey = Boolean(key);
      state.mode = 'waiting_custom_ai_model';
      stateManager.set(userId, state);
      return this.sendMessage(userId, t('settings.ai.custom.model_prompt', null, loc));
    }

    if (state.mode === 'waiting_custom_ai_model') {
      const loc = await this.locale(userId);
      const model = msg.text?.trim();
      if (!model) return this.sendMessage(userId, t('settings.ai.custom.model_prompt', null, loc));
      const draft = state.customAi || {};
      await this.sendMessage(userId, t('settings.ai.custom.testing', null, loc));
      try {
        const row = await SettingsService.addCustomProvider({
          label: draft.label,
          baseUrl: draft.baseUrl,
          defaultModel: model,
          requiresKey: draft.requiresKey !== false
        });
        await SecretsService.setProviderSecret(row.id, { apiKey: draft.apiKey || '' });
        await AiProviderRegistry.refreshCustom();
        await AiProviderRegistry.validateConfig(row.id, { apiKey: draft.apiKey || '' }, model);
        await SettingsService.setActiveProvider(row.id);
        await this.clearState(userId);
        await this.sendMessage(userId, '✅ ' + t('settings.ai.custom.saved', { label: row.label }, loc), {}, { append: true });
        return this.showSettingsAi(userId);
      } catch (err) {
        const failedId = SettingsService.slugifyLabel(draft.label);
        const existing = await SettingsService.getCustomProvider(failedId);
        if (existing) {
          await SettingsService.removeCustomProvider(existing.id);
          await SecretsService.removeProviderSecret(existing.id);
          await AiProviderRegistry.refreshCustom();
        }
        await this.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
        await this.clearState(userId);
        return this.showSettingsAi(userId);
      }
    }

    const editModes = [
      'waiting_custom_ai_edit_label',
      'waiting_custom_ai_edit_url',
      'waiting_custom_ai_edit_key',
      'waiting_custom_ai_edit_model'
    ];
    if (editModes.includes(state.mode)) {
      const loc = await this.locale(userId);
      const { providerId } = state.customAiEdit || {};
      const provider = providerId ? await SettingsService.getCustomProvider(providerId) : null;
      if (!provider) {
        await this.clearState(userId);
        return this.showSettingsAi(userId);
      }
      const value = msg.text?.trim();
      if (state.mode === 'waiting_custom_ai_edit_key') {
        if (value === undefined || value === '') {
          return this.sendMessage(userId, t('settings.ai.custom.key_prompt', null, loc));
        }
        let key = value === '-' ? '' : value;
        await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
        await SecretsService.setProviderSecret(providerId, { apiKey: key });
        await AiProviderRegistry.refreshCustom();
        const model = (await SettingsService.getModel(providerId)) || provider.defaultModel;
        try {
          await AiProviderRegistry.validateConfig(providerId, { apiKey: key }, model);
        } catch (err) {
          await this.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
          await this.clearState(userId);
          return this.showSettingsAi(userId);
        }
        await this.clearState(userId);
        await this.sendMessage(userId, '✅ ' + t('settings.ai.custom.updated', { label: provider.label }, loc), {}, { append: true });
        return this.showSettingsAi(userId);
      }
      if (!value) {
        const promptKey = {
          waiting_custom_ai_edit_label: 'settings.ai.custom.label_prompt',
          waiting_custom_ai_edit_url: 'settings.ai.custom.url_prompt',
          waiting_custom_ai_edit_model: 'settings.ai.custom.model_prompt'
        }[state.mode];
        return this.sendMessage(userId, t(promptKey, null, loc));
      }
      const patch = {};
      if (state.mode === 'waiting_custom_ai_edit_label') patch.label = value;
      if (state.mode === 'waiting_custom_ai_edit_url') {
        if (!/^https?:\/\/.+/i.test(value)) {
          return this.sendMessage(userId, t('settings.ai.custom.url_prompt', null, loc));
        }
        patch.baseUrl = value;
      }
      if (state.mode === 'waiting_custom_ai_edit_model') patch.defaultModel = value;
      await this.sendMessage(userId, t('settings.ai.custom.testing', null, loc));
      try {
        const updated = await SettingsService.updateCustomProvider(providerId, patch);
        await AiProviderRegistry.refreshCustom();
        const secrets = await SecretsService.getProviderSecret(providerId);
        const model = patch.defaultModel || (await SettingsService.getModel(providerId)) || updated.defaultModel;
        await AiProviderRegistry.validateConfig(providerId, secrets, model);
        await this.clearState(userId);
        await this.sendMessage(userId, '✅ ' + t('settings.ai.custom.updated', { label: updated.label }, loc), {}, { append: true });
        return this.showSettingsAi(userId);
      } catch (err) {
        await this.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
        await this.clearState(userId);
        return this.showSettingsAi(userId);
      }
    }

    if (state.mode === 'waiting_ai_secret') {
      const provider = AiProviderRegistry.get(state.providerId);
      if (!provider) {
        await this.clearState(userId);
        return this.sendMessage(userId, 'Сервис не найден.', await MenuService.getMainMenu());
      }

      const value = msg.text?.trim();
      if (!value) {
        return this.sendMessage(userId, 'Отправьте значение текстом.');
      }

      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      await this.sendMessage(userId, '⏳ Проверяю подключение, подождите…');

      const fields = { [state.secretField]: value };
      await SecretsService.setProviderSecret(state.providerId, fields);

      const model = (await SettingsService.getModel(state.providerId)) || provider.defaultModel;
      const locale = await this.locale(userId);
      const autoEnrich = await SettingsService.getAutoEnrich();

      try {
        await AiProviderRegistry.validateConfig(state.providerId, fields, model);
        await SettingsService.setActiveProvider(state.providerId);
        const masked = SecretsService.maskSecret(value);
        const configuredIds = await SettingsUIService.getConfiguredProviderIds();
        await this.sendMessage(
          userId,
          `✅ ${provider.label} подключён (${masked}). Сервис активирован.`,
          await MenuService.getSettingsAiMenu(state.providerId, autoEnrich, configuredIds, locale),
          { append: true }
        );
      } catch (err) {
        await SecretsService.removeProviderSecret(state.providerId);
        const ids = await SettingsUIService.getConfiguredProviderIds();
        const errText = await SettingsUIService.formatAiConnectError(err, locale);
        try {
          await this.sendMessage(userId, errText, {
            parse_mode: 'HTML',
            ...(await MenuService.getSettingsAiMenu(await SettingsService.getActiveProvider(), autoEnrich, ids, locale))
          }, { append: true });
        } catch (sendErr) {
          console.error('[BotService] AI connect error UI failed:', sendErr.message);
          await this.sendMessage(
            userId,
            `❌ Не удалось подключить ${provider.label}. ${err?.message || sendErr.message}`,
            await MenuService.getSettingsAiMenu(await SettingsService.getActiveProvider(), autoEnrich, ids, locale),
            { append: true, noNav: true }
          );
        }
      }

      await this.clearState(userId);
      return;
    }

    if (state.mode === 'waiting_timezone') {
      const tz = msg.text?.trim();
      if (!tz) return this.sendMessage(userId, 'Укажите часовой пояс.');
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
      } catch {
        return this.sendMessage(userId, 'Неверный часовой пояс. Пример: Europe/Moscow');
      }
      await SettingsService.setTimezone(tz);
      await this.clearState(userId);
      await this.sendMessage(userId, `Часовой пояс: ${tz} ✅`);
      return this.showSettingsGeneral(userId);
    }

    if (state.mode === 'waiting_time') {
      const t = msg.text?.trim();
      const parts = t?.split(':');
      if (!parts || parts.length !== 2) {
        return this.sendMessage(userId, 'Неверный формат. Укажите время как HH:mm.');
      }
      const hour = parseInt(parts[0], 10);
      const minute = parseInt(parts[1], 10);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return this.sendMessage(userId, 'Неверный формат времени.');
      }

      const date = new Date(`${state.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`);
      if (date <= new Date()) {
        return this.sendMessage(userId, 'Дата/время в прошлом, выберите другое.');
      }

      const meta = {
        preview: state.previewText || '',
        media: state.media || null
      };

      if (state.scheduledId) {
        await this.postRepository.updatePublishAt(state.scheduledId, date.toISOString());
        await this.sendMessage(userId, `Публикация перенесена на ${date.toLocaleString('ru-RU')} ✅`);
        const filter = state.historyFilter || 'scheduled';
        stateManager.set(userId, {
          mode: 'history_view',
          historyFilter: filter,
          historyPage: state.historyPage || 0
        });
        return this.showHistoryList(userId, filter, state.historyPage || 0);
      }

      await this.postRepository.addScheduled(
        userId,
        state.chatId,
        state.messageId,
        date.toISOString(),
        meta
      );
      if (state.draftId) {
        await DraftService.remove(state.draftId);
      }
      await this.sendMessage(userId, `Запланировано на ${date.toLocaleString('ru-RU')} ✅`, await MenuService.getMainMenu());
      await this.clearState(userId, { releaseStaging: false });
      return;
    }

    if (msg.text) {
      await this.sendMessage(userId, 'Сейчас это сообщение не обрабатывается. Используйте меню.');
    }
  }

  async sendPublishConfirmation(userId, channelMessage) {
    const url = buildPostUrl(channelMessage.message_id);
    try {
      if (url) {
        const opts = {
          reply_markup: { inline_keyboard: [[{ text: 'Перейти в канал', url }]] }
        };
        await this.sendMessage(userId, 'Пост опубликован ✅', opts);
      } else {
        await this.sendMessage(userId, 'Пост опубликован ✅');
      }
    } catch (e) {
      console.error('publish confirmation failed', e);
      await this.sendMessage(userId, 'Пост опубликован ✅');
    }
    await this.sendMessage(userId, 'Выберите действие:', await MenuService.getMainMenu(), { append: true });
  }

  async handleStats(msg) {
    const userId = msg.from.id;
    if (!this.isAdmin(userId)) return;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);

    try {
      const count = await ExistingPosts.count();
      const posts = await ExistingPosts.getAll();
      const pending = await this.postRepository.getAllPending();

      const mediaCount = posts.filter((p) => p.media).length;
      const textOnlyCount = posts.filter((p) => !p.media).length;
      const withReplies = posts.filter((p) => p.replyTo).length;
      const editedCount = posts.filter((p) => p.lifecycleStatus === 'edited').length;
      const deletedCount = posts.filter((p) => p.lifecycleStatus === 'deleted').length;

      const stats =
        `📊 <b>Статистика постов</b>\n\n` +
        `├ В архиве: <b>${count}</b>\n` +
        `├ Запланировано: <b>${pending.length}</b>\n` +
        `├ Изменено: <b>${editedCount}</b>\n` +
        `├ Удалено: <b>${deletedCount}</b>\n` +
        `├ С медиа: <b>${mediaCount}</b>\n` +
        `├ Только текст: <b>${textOnlyCount}</b>\n` +
        `└ С ответами: <b>${withReplies}</b>`;

      await this.sendMessage(userId, stats, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[BotService] handleStats error:', err.message);
      await this.sendMessage(userId, '❌ Ошибка при получении статистики');
    }
  }

  _channelMatches(msg) {
    const configured = String(CHANNEL_ID);
    const chatId = String(msg.chat.id);
    if (chatId === configured) return true;
    if (configured.startsWith('@')) {
      const uname = msg.chat.username;
      return uname === configured.slice(1) || `@${uname}` === configured;
    }
    return false;
  }

  async handleEditedChannelPost(msg) {
    try {
      if (!msg?.chat || !this._channelMatches(msg)) return;

      const messageId = msg.message_id;
      const fullText = extractText(msg);
      const media = parseMedia(msg);
      const editedAt = msg.edit_date
        ? new Date(msg.edit_date * 1000).toISOString()
        : new Date().toISOString();

      console.log(`[BotService] ✏️  Post #${messageId} edited`);

      const updated = await ExistingPosts.applyEdit(messageId, fullText, media, editedAt);
      await ProcessedPosts.unmarkProcessed(messageId);
      SummaryService.enrichPost(messageId, fullText, { force: true }).catch(console.error);

      if (updated) {
        console.log(`[BotService] ✅ Post #${messageId} updated in DB`);
      }
    } catch (err) {
      console.error('[BotService] handleEditedChannelPost error:', err.message);
    }
  }

  async handleChannelPost(msg) {
    try {
      if (!msg?.chat) return;

      if (!this._channelMatches(msg)) {
        console.log(`[BotService] ⚠️  Post from another channel: ${msg.chat.id}`);
        return;
      }

      const messageId = msg.message_id;
      console.log(`[BotService] 📥 Post #${messageId}`);

      const fullText = extractText(msg);
      const media = parseMedia(msg);
      if (!fullText?.trim() && !media) {
        console.log(`[BotService] Skip empty channel post #${messageId}`);
        return;
      }

      const replyToId = msg.reply_to_message ? msg.reply_to_message.message_id : null;
      const mediaGroupId = msg.media_group_id ? String(msg.media_group_id) : null;

      const added = await ExistingPosts.addPost(messageId, fullText, media, replyToId, mediaGroupId);
      if (added) {
        console.log(`[BotService] ✅ Post #${messageId} added to DB`);
        SummaryService.enrichPost(messageId, fullText).catch(console.error);
      }
    } catch (err) {
      console.error('[BotService] handleChannelPost error:', err.message);
    }
  }

  async startAiWizard(userId) {
    if (!(await WritingService.canWrite())) {
      return this.sendMessage(userId, 'ИИ не настроен. Подключите сервис в <b>Настройки → ИИ для постов</b>.', {
        parse_mode: 'HTML',
        ...(await MenuService.getMainMenu())
      });
    }

    stateManager.set(userId, {
      mode: 'wizard_title',
      wizard: WritingService.emptyWizard(),
      wizardStepRevisit: false
    });
    return this.showWizardStep(userId, 'wizard_title');
  }

  async showWizardStep(userId, mode) {
    const ui = await UiStyleService.get();
    const state = stateManager.get(userId);
    const wizard = state?.wizard;
    const editing = state?.wizardStepEditing === mode;
    const revisit = Boolean(state?.wizardStepRevisit);
    const filled = WritingService.isStepFilled(mode, wizard) && !editing && revisit;

    if (mode === 'wizard_media') {
      return this.showWizardMediaStep(userId, state, ui);
    }
    if (mode === 'wizard_language') {
      const info = WIZARD_STEP_INFO[mode];
      return this.sendMessage(
        userId,
        WritingService.formatStepMessage(info.prompt, mode, wizard, { editing, revisit: filled }),
        {
          parse_mode: 'HTML',
          ...MenuService.getWizardLanguageMenu(mode, { filled, editing, ui })
        }
      );
    }
    if (mode === 'wizard_style') {
      const info = WIZARD_STEP_INFO[mode];
      return this.sendMessage(
        userId,
        WritingService.formatStepMessage(info.prompt, mode, wizard, { editing, revisit: filled }),
        {
          parse_mode: 'HTML',
          ...MenuService.getWizardStyleMenu(mode, { filled, editing, ui, wizard })
        }
      );
    }
    const info = WIZARD_STEP_INFO[mode];
    if (!info?.prompt) return Promise.resolve();
    return this.sendMessage(
      userId,
      WritingService.formatStepMessage(info.prompt, mode, wizard, { editing, revisit: filled }),
      {
        parse_mode: 'HTML',
        ...MenuService.getWizardStepMenu(info.skip, mode, { filled, ui })
      }
    );
  }

  async showWizardMediaStep(userId, state, ui = null) {
    if (!ui) ui = await UiStyleService.get();
    const wizard = state?.wizard;
    MediaLib.migrateLegacyMedia(wizard);
    const mode = 'wizard_media';
    const editing = state?.wizardStepEditing === mode;
    const revisit = Boolean(state?.wizardStepRevisit);
    const filled = WritingService.isStepFilled(mode, wizard) && !editing && revisit;
    const page = wizard?.mediaGalleryPage || 0;

    if (wizard?.mediaPreviewHidden && wizard?.selectedMediaIds?.length) {
      wizard.mediaPreviewHidden = false;
    }

    const stagedIds = WritingService.getStagedMessageIds(wizard);
    if (!wizard?.mediaPreviewHidden && wizard?.selectedMediaIds?.length && !stagedIds.length) {
      try {
        await WritingService.restageWizardMedia(this.bot, userId, wizard);
      } catch (err) {
        console.error('[BotService] restageWizardMedia:', err.message);
      }
    }

    return this.sendMessage(
      userId,
      WritingService.formatMediaStepHint(wizard, { editing }),
      {
        parse_mode: 'HTML',
        ...MenuService.getWizardMediaGalleryMenu('wizard_skip_media', { wizard, mode, filled, editing, ui, page })
      }
    );
  }

  async refreshWizardMediaPreview(userId, wizard) {
    if (!wizard?.selectedMediaIds?.length) {
      await WritingService.hideWizardMediaPreview(this.bot, userId, wizard);
      return;
    }
    try {
      await WritingService.restageWizardMedia(this.bot, userId, wizard);
      wizard.mediaPreviewHidden = false;
    } catch (err) {
      console.error('[BotService] refreshWizardMediaPreview:', err.message);
    }
  }

  async startWizardStepEdit(userId, state) {
    const mode = state.mode;
    state.wizardStepEditing = mode;
    state.wizardStepRevisit = false;
    if (mode === 'wizard_media') {
      await WritingService.hideWizardMediaPreview(this.bot, userId, state.wizard);
      MediaLib.clearPool(state.wizard);
    }
    stateManager.set(userId, state);
    return this.showWizardStep(userId, mode);
  }

  finishWizardStepInput(userId, state) {
    const mode = state.mode;
    const wasEditing = state.wizardStepEditing === mode;
    delete state.wizardStepEditing;
    if (wasEditing) {
      state.wizardStepRevisit = true;
    }
    stateManager.set(userId, state);
    if (wasEditing) {
      return this.showWizardStep(userId, mode);
    }
    return this.goToNextWizardStep(userId, state);
  }

  isWizardStepAwaitingChoice(state) {
    if (!state?.wizard) return false;
    const mode = state.mode;
    const editing = state.wizardStepEditing === mode;
    const revisit = Boolean(state.wizardStepRevisit);
    return (
      !editing &&
      revisit &&
      WritingService.isStepFilled(mode, state.wizard) &&
      WIZARD_FLOW.includes(mode)
    );
  }

  async addWizardMediaMessages(userId, msgs, state) {
    if (!state?.wizard) return;
    const ui = await UiStyleService.get();
    MediaLib.migrateLegacyMedia(state.wizard);

    const items = [];
    for (const msg of msgs) {
      const item = WritingService.extractMediaItem(msg);
      if (!item) continue;
      items.push(item);
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
    }
    if (!items.length) return;

    const result = MediaLib.addToPool(state.wizard, items);
    state.wizard.mediaPreviewHidden = false;
    stateManager.set(userId, state);

    await this.refreshWizardMediaPreview(userId, state.wizard);

    if (result.skipped > 0) {
      await this.sendMessage(
        userId,
        `⚠️ Не добавлено ${result.skipped} файлов — лимит библиотеки (${MediaLib.POOL_MAX}).`,
        { append: true }
      );
    }

    return this.showWizardMediaStep(userId, state, ui);
  }

  getNextWizardMode(current) {
    const idx = WIZARD_FLOW.indexOf(current);
    if (idx < 0 || idx >= WIZARD_FLOW.length - 1) return null;
    return WIZARD_FLOW[idx + 1];
  }

  async goToNextWizardStep(userId, state) {
    const current = state.mode;
    const next = this.getNextWizardMode(current);
    if (!next) {
      return this.finishWizardAndGenerate(userId, state);
    }
    if (current === 'wizard_media') {
      await WritingService.hideWizardMediaPreview(this.bot, userId, state.wizard);
    }
    state.mode = next;
    state.wizardStepRevisit = false;
    delete state.wizardStepEditing;
    stateManager.set(userId, state);
    return this.showWizardStep(userId, next);
  }

  async finishWizardAndGenerate(userId, state) {
    if (!WritingService.hasWizardInput(state.wizard)) {
      await this.clearState(userId);
      return this.sendMessage(
        userId,
        'Вы ничего не указали — создание поста отменено.',
        await MenuService.getMainMenu()
      );
    }
    return this.runWizardGeneration(userId, state);
  }

  async runWizardGeneration(userId, state) {
    state.mode = 'wizard_generating';
    stateManager.set(userId, state);
    await this.sendMessage(userId, '⏳ Генерирую текст поста…', {}, { noNav: true });

    try {
      const bodyHtml = await WritingService.generatePost(state.wizard);
      state.mode = 'wizard_review';
      state.wizard.regenerateCount = (state.wizard.regenerateCount || 0) + 1;
      stateManager.set(userId, state);
      await WritingService.sendPreview(this.bot, userId, state.wizard, bodyHtml);
      return this.showWizardReview(userId, state);
    } catch (err) {
      console.error('[BotService] wizard generate error:', err.message);
      state.mode = 'wizard_generate_error';
      stateManager.set(userId, state);
      const msg = WritingService.formatGenerateError(err);
      return this.sendMessage(userId, `❌ ${msg}`, MenuService.getWizardErrorMenu(await UiStyleService.get()));
    }
  }

  async showWizardReview(userId, state, extraNote = '') {
    const regenLimit = (state.wizard.regenerateCount || 0) >= 3;
    const ui = await UiStyleService.get();
    let text =
      '✨ <b>Предпросмотр поста</b>\n\n' +
      'Текст выше — так пост будет выглядеть в канале.\n' +
      'Примите, перегенерируйте или отредактируйте вручную.';
    if (extraNote) text += `\n\n${extraNote}`;
    if (regenLimit) {
      text += '\n\n<i>Лимит перегенераций (3) исчерпан — доступно ручное редактирование.</i>';
    }
    return this.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...MenuService.getWizardReviewMenu({ regenerateDisabled: regenLimit, ui })
    });
  }

  async acceptWizardReview(userId, state) {
    const stagedIds = WritingService.getStagedMessageIds(state.wizard);
    const publishIds = stagedIds.length
      ? stagedIds
      : (state.wizard.previewMessageIds || []);

    if (!publishIds.length && !state.wizard.bodyHtml?.trim()) {
      return this.sendMessage(userId, 'Предпросмотр не найден. Начните заново.', await MenuService.getMainMenu());
    }

    const stagedMeta = publishIds.map((_, i) => ({
      text: i === 0 ? (state.wizard.bodyHtml || '') : '',
      media: state.wizard.stagedMedia?.[i]?.media || null
    }));

    stateManager.set(userId, {
      mode: 'choose_post_action',
      chatId: userId,
      messageId: publishIds[0] || null,
      stagingMessageId: publishIds[0] || null,
      stagingMessageIds: publishIds,
      stagedMeta,
      previewText: state.wizard.bodyHtml,
      media: summarizeMediaCollection(state.wizard.stagedMedia),
      wizardMeta: {
        title: state.wizard.title,
        brief: state.wizard.brief,
        tone: state.wizard.tone,
        language: state.wizard.language,
        languageNote: state.wizard.languageNote,
        postStyle: state.wizard.postStyle,
        postStyleNote: state.wizard.postStyleNote,
        keywords: state.wizard.keywords
      }
    });
    return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get()));
  }

  async handleWizardCallback(userId, data, state) {
    if (data === 'wizard_back') {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.wizardGoBack(userId, state);
    }

    if (data === 'wizard_steps') {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.sendMessage(userId, 'Перейти к шагу:', MenuService.getWizardStepsMenu(state.mode, state.wizard, await UiStyleService.get()));
    }

    if (data === 'wizard_steps_close') {
      return this.restoreWorkflowUi(userId, state);
    }

    if (data === 'wizard_goto_review') {
      if (!state?.wizard?.bodyHtml) {
        return this.sendMessage(userId, 'Сначала сгенерируйте текст поста.');
      }
      state.mode = 'wizard_review';
      delete state.wizardReplaceMedia;
      stateManager.set(userId, state);
      return this.showWizardReview(userId, state);
    }

    const gotoMatch = data.match(/^wizard_goto_(wizard_[a-z_]+)$/);
    if (gotoMatch) {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      if (state.mode === 'wizard_media' && gotoMatch[1] !== 'wizard_media') {
        await WritingService.hideWizardMediaPreview(this.bot, userId, state.wizard);
      }
      state.mode = gotoMatch[1];
      delete state.wizardReplaceMedia;
      delete state.wizardStepEditing;
      state.wizardStepRevisit = WritingService.isStepFilled(state.mode, state.wizard);
      stateManager.set(userId, state);
      return this.showWizardStep(userId, gotoMatch[1]);
    }

    if (data === 'wizard_keep') {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.goToNextWizardStep(userId, state);
    }

    if (data === 'wizard_edit') {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.startWizardStepEdit(userId, state);
    }

    if (!state?.wizard && data !== 'wizard_generate_retry') {
      return this.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
    }

    const skipMap = {
      wizard_skip_title: 'title',
      wizard_skip_brief: 'brief',
      wizard_skip_tone: 'tone',
      wizard_skip_media: 'media',
      wizard_skip_keywords: 'keywords'
    };

    if (WIZARD_LANG_PRESETS[data]) {
      state.wizard.language = WIZARD_LANG_PRESETS[data];
      state.wizard.languageNote = '';
      stateManager.set(userId, state);
      if (state.wizardStepEditing === 'wizard_language') {
        return this.finishWizardStepInput(userId, state);
      }
      return this.goToNextWizardStep(userId, state);
    }

    if (WIZARD_STYLE_PRESETS[data]) {
      const styleId = WIZARD_STYLE_PRESETS[data];
      if (!state.wizard.postStyles) state.wizard.postStyles = [];
      const idx = state.wizard.postStyles.indexOf(styleId);
      if (idx >= 0) state.wizard.postStyles.splice(idx, 1);
      else state.wizard.postStyles.push(styleId);
      state.wizard.postStyle = '';
      stateManager.set(userId, state);
      return this.showWizardStep(userId, 'wizard_style');
    }

    if (data === 'wizard_style_done') {
      return this.goToNextWizardStep(userId, state);
    }

    if (data === 'wizard_skip_language') {
      state.wizard.language = '';
      state.wizard.languageNote = '';
      stateManager.set(userId, state);
      return this.goToNextWizardStep(userId, state);
    }

    if (data === 'wizard_skip_style') {
      state.wizard.postStyle = '';
      state.wizard.postStyles = [];
      state.wizard.postStyleNote = '';
      stateManager.set(userId, state);
      return this.goToNextWizardStep(userId, state);
    }

    if (skipMap[data]) {
      if (data === 'wizard_skip_media' && state.wizardReplaceMedia) {
        await WritingService.releaseStagedMedia(this.bot, userId, state.wizard, { clearPool: true });
        delete state.wizardReplaceMedia;
        state.mode = 'wizard_review';
        stateManager.set(userId, state);
        if (state.wizard.bodyHtml) {
          await WritingService.sendPreview(this.bot, userId, state.wizard, state.wizard.bodyHtml);
        }
        return this.showWizardReview(userId, state, 'Медиа убрано.');
      }

      if (data === 'wizard_skip_media') {
        await WritingService.releaseStagedMedia(this.bot, userId, state.wizard, { clearPool: true });
      } else {
        state.wizard[skipMap[data]] = '';
      }
      stateManager.set(userId, state);
      return this.goToNextWizardStep(userId, state);
    }

    if (data === 'wizard_media_done') {
      MediaLib.migrateLegacyMedia(state.wizard);
      const poolTotal = state.wizard.mediaPool?.length || 0;
      const selected = state.wizard.selectedMediaIds?.length || 0;
      if (poolTotal > 0 && selected === 0) {
        return this.sendMessage(
          userId,
          'Выберите хотя бы один файл для поста (кнопки с номерами) или удалите файлы из библиотеки.'
        );
      }
      if (state.wizardReplaceMedia) {
        delete state.wizardReplaceMedia;
        state.mode = 'wizard_review';
        stateManager.set(userId, state);
        if (state.wizard.bodyHtml) {
          await WritingService.sendPreview(this.bot, userId, state.wizard, state.wizard.bodyHtml);
        }
        return this.showWizardReview(userId, state, 'Медиа обновлено.');
      }
      return this.goToNextWizardStep(userId, state);
    }

    const mediaToggleMatch = data.match(/^wizard_media_toggle_([a-f0-9]+)$/);
    if (mediaToggleMatch) {
      const result = MediaLib.toggleSelect(state.wizard, mediaToggleMatch[1]);
      if (!result.ok) {
        const ui = await UiStyleService.get();
        return this.sendMessage(userId, result.error, MenuService.getWizardMediaGalleryMenu('wizard_skip_media', {
          wizard: state.wizard,
          mode: 'wizard_media',
          filled: false,
          editing: state.wizardStepEditing === 'wizard_media',
          ui,
          page: state.wizard.mediaGalleryPage || 0
        }));
      }
      stateManager.set(userId, state);
      await this.refreshWizardMediaPreview(userId, state.wizard);
      return this.showWizardMediaStep(userId, state);
    }

    const mediaRmMatch = data.match(/^wizard_media_rm_([a-f0-9]+)$/);
    if (mediaRmMatch) {
      MediaLib.removeFromPool(state.wizard, mediaRmMatch[1]);
      stateManager.set(userId, state);
      await this.refreshWizardMediaPreview(userId, state.wizard);
      return this.showWizardMediaStep(userId, state);
    }

    const mediaPageMatch = data.match(/^wizard_media_page_(\d+)$/);
    if (mediaPageMatch) {
      state.wizard.mediaGalleryPage = parseInt(mediaPageMatch[1], 10);
      stateManager.set(userId, state);
      return this.showWizardMediaStep(userId, state);
    }

    if (data === 'wizard_media_page_noop') {
      return Promise.resolve();
    }

    if (data === 'wizard_generate_retry') {
      if (!state?.wizard) {
        return this.sendMessage(userId, 'Сессия мастера истекла.', await MenuService.getMainMenu());
      }
      return this.runWizardGeneration(userId, state);
    }

    if (data === 'wizard_review_regenerate') {
      if ((state.wizard.regenerateCount || 0) >= 3) {
        return this.showWizardReview(userId, state);
      }
      return this.runWizardGeneration(userId, state);
    }

    if (data === 'wizard_review_accept') {
      return this.acceptWizardReview(userId, state);
    }

    if (data === 'wizard_review_edit') {
      state.mode = 'wizard_edit';
      stateManager.set(userId, state);
      return this.sendMessage(
        userId,
        'Отправьте новый текст поста.\n\n' +
          'Можно использовать HTML: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;a href="..."&gt;</code>',
        { parse_mode: 'HTML' }
      );
    }

    if (data === 'wizard_review_replace_media') {
      await WritingService.hideWizardMediaPreview(this.bot, userId, state.wizard);
      MediaLib.clearPool(state.wizard);
      state.mode = 'wizard_media';
      state.wizardReplaceMedia = true;
      state.wizard.mediaGalleryPage = 0;
      stateManager.set(userId, state);
      return this.showWizardMediaStep(userId, state);
    }
  }

  async handleWizardTextStep(userId, msg, state, field) {
    if (this.isWizardStepAwaitingChoice(state)) {
      return this.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const value = msg.text?.trim();
    if (!value) {
      return this.sendMessage(userId, 'Отправьте текст или нажмите «Пропустить».');
    }
    state.wizard[field] = value;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    stateManager.set(userId, state);
    return this.finishWizardStepInput(userId, state);
  }

  async handleWizardLanguageStep(userId, msg, state) {
    if (this.isWizardStepAwaitingChoice(state)) {
      return this.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const ui = await UiStyleService.get();
    const value = msg.text?.trim();
    if (!value) {
      return this.sendMessage(
        userId,
        'Выберите вариант кнопкой или опишите правила языка текстом.',
        MenuService.getWizardLanguageMenu('wizard_language', {
          filled: false,
          editing: state.wizardStepEditing === 'wizard_language',
          ui
        })
      );
    }
    state.wizard.language = 'custom';
    state.wizard.languageNote = value;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    stateManager.set(userId, state);
    return this.finishWizardStepInput(userId, state);
  }

  async handleWizardStyleStep(userId, msg, state) {
    if (this.isWizardStepAwaitingChoice(state)) {
      return this.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const ui = await UiStyleService.get();
    const value = msg.text?.trim();
    if (!value) {
      return this.sendMessage(
        userId,
        'Выберите формат кнопкой или опишите особенность поста текстом.',
        MenuService.getWizardStyleMenu('wizard_style', {
          filled: false,
          editing: state.wizardStepEditing === 'wizard_style',
          ui,
          wizard: state.wizard
        })
      );
    }
    state.wizard.postStyle = '';
    state.wizard.postStyleNote = value;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    stateManager.set(userId, state);
    return this.finishWizardStepInput(userId, state);
  }

  async handleWizardEditStep(userId, msg, state) {
    const raw = msg.text?.trim();
    if (!raw) {
      return this.sendMessage(userId, 'Отправьте текст поста.');
    }

    const { escapeHtml } = require('../utils/telegramHtml');
    const bodyHtml = raw.includes('<') ? sanitizeTelegramHtml(raw) : escapeHtml(raw);

    if (state.wizard.stagedMedia?.length && captionTooLong(bodyHtml)) {
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      return this.sendMessage(
        userId,
        `Подпись к медиа не длиннее ${CAPTION_MAX} символов. Сократите текст.`
      );
    }

    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    state.mode = 'wizard_review';
    stateManager.set(userId, state);
    await WritingService.sendPreview(this.bot, userId, state.wizard, bodyHtml);
    return this.showWizardReview(userId, state);
  }
}

module.exports = BotService;
