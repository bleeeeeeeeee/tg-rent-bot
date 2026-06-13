const TelegramBot = require('node-telegram-bot-api');
const { BOT_TOKEN, ADMIN_ID, CHANNEL_ID, OWNER_TELEGRAM_ID } = require('../config');
const PostService = require('./PostService');
const ChannelPostService = require('./ChannelPostService');
const DraftService = require('./DraftService');
const MenuService = require('./MenuService');
const stateManager = require('./StateManager');
const ExistingPosts = require('./ExistingPosts');
const SummaryService = require('./SummaryService');
const ProcessedPosts = require('./ProcessedPosts');
const SettingsService = require('./SettingsService');
const AccessService = require('./AccessService');
const AdminHandlers = require('./AdminHandlers');
const TopicHandlers = require('../handlers/TopicHandlers');
const WizardHandlers = require('../handlers/WizardHandlers');
const HistoryHandlers = require('../handlers/HistoryHandlers');
const DraftHandlers = require('../handlers/DraftHandlers');
const SettingsHandlers = require('../handlers/SettingsHandlers');
const { WIZARD_MODES } = require('../constants/wizardUi');
const { t } = require('../i18n');
const ChatCleanupService = require('./ChatCleanupService');
const { initChannelUrl, buildPostUrl, resolveChannelDisplay } = require('../utils/channelUrl');
const WritingService = require('./WritingService');
const UiStyleService = require('./UiStyleService');
const MediaGroupCollector = require('./MediaGroupCollector');
const { extractText, parseMedia } = require('../utils/messageParse');
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
  'waiting_channel_edit_text',
  'topic_choose_count',
  'topic_generating',
  'topic_review',
  'topic_pick_reference'
]);

class BotService {
  constructor(postRepository, { usePolling = true } = {}) {
    this.usePolling = usePolling;
    const botOptions = usePolling
      ? { polling: { interval: 300, autoStart: true, params: { timeout: 10 } } }
      : { webHook: false };

    this.bot = new TelegramBot(BOT_TOKEN, botOptions);

    if (usePolling) {
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
    }
    this.bot.on('webhook_error', (err) => console.error('webhook_error', err));

    this.postService = new PostService(this.bot);
    this.channelPostService = new ChannelPostService(this.bot);
    this.postRepository = postRepository;
    this.adminHandlers = new AdminHandlers(this);
    this.wizardHandlers = new WizardHandlers(this);
    this.historyHandlers = new HistoryHandlers(this);
    this.draftHandlers = new DraftHandlers(this);
    this.settingsHandlers = new SettingsHandlers(this);
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
    const UserSettingsService = require('./UserSettingsService');
    return UserSettingsService.getLocale(userId);
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
        return this.sendMessage(userId, text, MenuService.getCancelConfirmMenu({ saveKind, ui: await UiStyleService.get(userId) }));
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
      const ui = await UiStyleService.get(userId);
      return this.sendMessage(userId, 'Продолжайте или выберите действие:', MenuService.getWizardErrorMenu(ui));
    }
    if (state.mode === 'choose_post_action') {
      const ui = await UiStyleService.get(userId);
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
    const UserSettingsService = require('./UserSettingsService');
    if (!(await UserSettingsService.getChatCleanup(userId))) return;
    if (!this.isAdmin(userId)) return;
    if (!force && ChatCleanupService.hasReplyKeyboard(userId)) return;
    await ChatCleanupService.ensureReplyKeyboard(
      this.bot,
      userId,
      await MenuService.getReplyMenuKeyboard()
    );
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
    if (options.transient !== undefined) {
      sendOpts = { ...sendOpts, transient: options.transient };
      delete options.transient;
    }
    const { append = false, pinned = false, track = true, noNav = false, transient = false } = sendOpts;
    const UserSettingsService = require('./UserSettingsService');
    const cleanup = await UserSettingsService.getChatCleanup(userId);

    if (cleanup) {
      await ChatCleanupService.flushTransient(this.bot, userId);
    }

    const previousEphemeral = !append && cleanup ? ChatCleanupService.snapshotEphemeral(userId) : [];

    options.reply_markup = options.reply_markup || {};
    if (!noNav && !options.reply_markup.inline_keyboard && !options.reply_markup.keyboard) {
      const ui = await UiStyleService.get(userId);
      options.reply_markup.inline_keyboard = MenuService.getNavRow('main', ui);
    }
    if (options.reply_markup.inline_keyboard && !cleanup) {
      options.reply_markup.remove_keyboard = true;
    } else if (!options.reply_markup.keyboard && !cleanup) {
      options.reply_markup.remove_keyboard = true;
    }

    let msg;
    try {
      msg = await this.bot.sendMessage(userId, text, options);
    } catch (err) {
      console.error('[BotService] sendMessage failed:', err.message);
      throw err;
    }

    if (track) {
      ChatCleanupService.trackBotMessage(userId, msg.message_id, { pinned, transient });
    }

    if (!append && cleanup && previousEphemeral.length) {
      await ChatCleanupService.deleteMessages(this.bot, userId, previousEphemeral);
    }

    if (!append && cleanup) {
      await this.ensureReplyMenuKeyboard(userId);
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
    this.bot.onText(/\/settings/, this._guardHandler('handleSettings', (msg) => this.settingsHandlers.handleCommand(msg)));
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
    const UserSettingsService = require('./UserSettingsService');
    await UserSettingsService.ensureUser(userId);
    const loc = await this.locale(userId);
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    await this.clearState(userId);
    ChatCleanupService.resetChat(userId);

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
    const ui = await UiStyleService.get(userId);
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
      return this.sendMessage(userId, 'Выберите черновик:', MenuService.getDraftsMenu(drafts, await UiStyleService.get(userId)));
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
      return this.settingsHandlers.handleCallback(userId, data);
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
          return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get(userId)));
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
          MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get(userId))
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
      return this.sendMessage(userId, 'Выберите дату:', MenuService.getCalendar(year, month, await UiStyleService.get(userId)));
    }

    const nextMatch = data.match(/^calendar_next_(\d+)-(\d+)$/);
    if (nextMatch) {
      const year = parseInt(nextMatch[1], 10);
      const month = parseInt(nextMatch[2], 10);
      return this.sendMessage(userId, 'Выберите дату:', MenuService.getCalendar(year, month, await UiStyleService.get(userId)));
    }

    const dateMatch = data.match(/^calendar_(\d{4}-\d{2}-\d{2})$/);
    if (dateMatch) {
      stateManager.set(userId, { ...state, mode: 'waiting_time', date: dateMatch[1] });
      return this.sendMessage(userId, `Дата ${dateMatch[1]}. Укажите время в формате HH:mm (например 14:30):`);
    }
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
      return this.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get(userId)));
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

    const adminHandled = await this.adminHandlers.handleMessageStep(userId, msg, state);
    if (adminHandled !== false) return;

    const settingsHandled = await this.settingsHandlers.handleMessageStep(userId, msg, state);
    if (settingsHandled !== false) return;

    const historyHandled = await this.historyHandlers.handleMessageStep(userId, msg, state);
    if (historyHandled !== false) return;

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

      const addedAt = msg.date ? new Date(msg.date * 1000).toISOString() : null;
      const added = await ExistingPosts.addPost(messageId, fullText, media, replyToId, mediaGroupId, addedAt);
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
