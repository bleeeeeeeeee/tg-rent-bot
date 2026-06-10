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
const WizardHandlers = require('../handlers/WizardHandlers');
const HistoryHandlers = require('../handlers/HistoryHandlers');
const DraftHandlers = require('../handlers/DraftHandlers');
const { WIZARD_MODES } = require('../constants/wizardUi');
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
    this.wizardHandlers = new WizardHandlers(this);
    this.historyHandlers = new HistoryHandlers(this);
    this.draftHandlers = new DraftHandlers(this);
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
      return this.wizardHandlers.showWizardReview(userId, state);
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
      return this.wizardHandlers.showWizardStep(userId, state.mode);
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
      return this.wizardHandlers.handleCallback(userId, data, state);
    }

    if (data === 'menu_drafts') {
      const drafts = await DraftService.getAll(userId);
      if (drafts.length === 0) {
        return this.sendMessage(userId, 'Черновиков нет.', await MenuService.getMainMenu());
      }
      return this.sendMessage(userId, 'Выберите черновик:', MenuService.getDraftsMenu(drafts, await UiStyleService.get()));
    }

    if (data === 'menu_history' || data.startsWith('history_')) {
      return this.historyHandlers.handleCallback(userId, data, state);
    }

    if (data.startsWith('draft_')) {
      return this.draftHandlers.handleCallback(userId, data, state);
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

    const wizardHandled = await this.wizardHandlers.handleMessageStep(userId, msg, state);
    if (wizardHandled !== false) return;

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

  async resumeWizardDraft(userId, draft) {
    return this.wizardHandlers.resumeWizardDraft(userId, draft);
  }

  async startAiWizard(userId) {
    return this.wizardHandlers.startAiWizard(userId);
  }

  async showWizardStep(userId, mode) {
    return this.wizardHandlers.showWizardStep(userId, mode);
  }

}

module.exports = BotService;
