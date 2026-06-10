const WritingService = require('../services/WritingService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const stateManager = require('../services/StateManager');
const ChatCleanupService = require('../services/ChatCleanupService');
const MediaLib = require('../services/WizardMediaLibrary');
const MediaGroupCollector = require('../services/MediaGroupCollector');
const { WIZARD_FLOW } = require('../constants/wizardSteps');
const { WIZARD_STEP_INFO, WIZARD_LANG_PRESETS, WIZARD_STYLE_PRESETS } = require('../constants/wizardUi');
const { sanitizeTelegramHtml, captionTooLong, CAPTION_MAX } = require('../utils/telegramHtml');
const { summarizeMediaCollection } = require('../utils/telegramMedia');

class WizardHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  get bot() {
    return this.bs.bot;
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

  async startAiWizard(userId) {
    if (!(await WritingService.canWrite())) {
      return this.bs.sendMessage(userId, 'ИИ не настроен. Подключите сервис в <b>Настройки → ИИ для постов</b>.', {
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
      return this.bs.sendMessage(
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
      return this.bs.sendMessage(
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
    return this.bs.sendMessage(
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

    return this.bs.sendMessage(
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
      await this.bs.sendMessage(
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
      await this.bs.clearState(userId);
      return this.bs.sendMessage(
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
    await this.bs.sendMessage(userId, '⏳ Генерирую текст поста…', {}, { noNav: true });

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
      return this.bs.sendMessage(userId, `❌ ${msg}`, MenuService.getWizardErrorMenu(await UiStyleService.get()));
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
    return this.bs.sendMessage(userId, text, {
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
      return this.bs.sendMessage(userId, 'Предпросмотр не найден. Начните заново.', await MenuService.getMainMenu());
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
    return this.bs.sendMessage(userId, 'Выберите действие с постом:', MenuService.getPostActionMenu(await UiStyleService.get()));
  }

  async handleCallback(userId, data, state) {
    return this.handleWizardCallback(userId, data, state);
  }

  async handleWizardCallback(userId, data, state) {
    if (data === 'wizard_back') {
      if (!state?.wizard) {
        return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.wizardGoBack(userId, state);
    }

    if (data === 'wizard_steps') {
      if (!state?.wizard) {
        return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.bs.sendMessage(userId, 'Перейти к шагу:', MenuService.getWizardStepsMenu(state.mode, state.wizard, await UiStyleService.get()));
    }

    if (data === 'wizard_steps_close') {
      return this.bs.restoreWorkflowUi(userId, state);
    }

    if (data === 'wizard_goto_review') {
      if (!state?.wizard?.bodyHtml) {
        return this.bs.sendMessage(userId, 'Сначала сгенерируйте текст поста.');
      }
      state.mode = 'wizard_review';
      delete state.wizardReplaceMedia;
      stateManager.set(userId, state);
      return this.showWizardReview(userId, state);
    }

    const gotoMatch = data.match(/^wizard_goto_(wizard_[a-z_]+)$/);
    if (gotoMatch) {
      if (!state?.wizard) {
        return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
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
        return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.goToNextWizardStep(userId, state);
    }

    if (data === 'wizard_edit') {
      if (!state?.wizard) {
        return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
      }
      return this.startWizardStepEdit(userId, state);
    }

    if (!state?.wizard && data !== 'wizard_generate_retry') {
      return this.bs.sendMessage(userId, 'Сессия мастера истекла. Начните заново.', await MenuService.getMainMenu());
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
        return this.bs.sendMessage(
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
        return this.bs.sendMessage(userId, result.error, MenuService.getWizardMediaGalleryMenu('wizard_skip_media', {
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
        return this.bs.sendMessage(userId, 'Сессия мастера истекла.', await MenuService.getMainMenu());
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
      return this.bs.sendMessage(
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
      return this.bs.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const value = msg.text?.trim();
    if (!value) {
      return this.bs.sendMessage(userId, 'Отправьте текст или нажмите «Пропустить».');
    }
    state.wizard[field] = value;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    stateManager.set(userId, state);
    return this.finishWizardStepInput(userId, state);
  }

  async handleWizardLanguageStep(userId, msg, state) {
    if (this.isWizardStepAwaitingChoice(state)) {
      return this.bs.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const ui = await UiStyleService.get();
    const value = msg.text?.trim();
    if (!value) {
      return this.bs.sendMessage(
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
      return this.bs.sendMessage(userId, 'Используйте кнопки навигации внизу: «Изменить», «Далее →» или «К шагам».');
    }
    const ui = await UiStyleService.get();
    const value = msg.text?.trim();
    if (!value) {
      return this.bs.sendMessage(
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
      return this.bs.sendMessage(userId, 'Отправьте текст поста.');
    }

    const { escapeHtml } = require('../utils/telegramHtml');
    const bodyHtml = raw.includes('<') ? sanitizeTelegramHtml(raw) : escapeHtml(raw);

    if (state.wizard.stagedMedia?.length && captionTooLong(bodyHtml)) {
      await ChatCleanupService.consumeUserMessage(this.bot, msg);
      return this.bs.sendMessage(
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
  /** handle wizard-related message modes from BotService.handleMessage */
  async handleMessageStep(userId, msg, state) {
    if (state.mode === 'wizard_title') return this.handleWizardTextStep(userId, msg, state, 'title');
    if (state.mode === 'wizard_brief') return this.handleWizardTextStep(userId, msg, state, 'brief');
    if (state.mode === 'wizard_tone') return this.handleWizardTextStep(userId, msg, state, 'tone');
    if (state.mode === 'wizard_language') return this.handleWizardLanguageStep(userId, msg, state);
    if (state.mode === 'wizard_style') return this.handleWizardStyleStep(userId, msg, state);
    if (state.mode === 'wizard_keywords') return this.handleWizardTextStep(userId, msg, state, 'keywords');
    if (state.mode === 'wizard_media') {
      if (this.isWizardStepAwaitingChoice(state)) {
        if (WritingService.isMediaMessage(msg) || msg.text?.trim()) {
          return this.bs.sendMessage(userId, 'Используйте кнопки навигации: «Изменить», «Далее →» или «К шагам».');
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
        return this.bs.sendMessage(userId, 'Отправьте медиа (фото, видео, документ…) или нажмите «Пропустить» / «Готово».');
      }
      return;
    }
    if (state.mode === 'wizard_edit') {
      if (WritingService.isMediaMessage(msg)) {
        return this.bs.sendMessage(userId, 'Сейчас нужен текст. Медиа можно заменить на экране предпросмотра.');
      }
      return this.handleWizardEditStep(userId, msg, state);
    }
    if (WIZARD_FLOW.includes(state.mode) && WritingService.isMediaMessage(msg)) {
      return this.bs.sendMessage(userId, 'Сначала завершите этот шаг. Медиа — на шаге 6/7.');
    }
    return false;
  }
}

module.exports = WizardHandlers;
