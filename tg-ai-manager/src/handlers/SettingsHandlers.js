const SettingsService = require('../services/SettingsService');
const UserSettingsService = require('../services/UserSettingsService');
const SecretsService = require('../services/SecretsService');
const SettingsUIService = require('../services/SettingsUIService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const ChatCleanupService = require('../services/ChatCleanupService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const stateManager = require('../services/StateManager');
const { t } = require('../i18n');

const SETTINGS_MESSAGE_MODES = new Set([
  'waiting_ai_secret',
  'waiting_timezone',
  'waiting_custom_ai_label',
  'waiting_custom_ai_url',
  'waiting_custom_ai_key',
  'waiting_custom_ai_model',
  'waiting_custom_ai_edit_label',
  'waiting_custom_ai_edit_url',
  'waiting_custom_ai_edit_key',
  'waiting_custom_ai_edit_model'
]);

class SettingsHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  get bot() {
    return this.bs.bot;
  }

  async handleCommand(msg) {
    if (!this.bs.isAdmin(msg.from.id)) return;
    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    await this.bs.clearState(msg.from.id);
    return this.showRoot(msg.from.id);
  }

  async showRoot(userId) {
    const ui = await UiStyleService.get(userId);
    const locale = await this.bs.locale(userId);
    const text = await SettingsUIService.formatSettingsRoot(userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsRootMenu(ui, locale))
    });
  }

  async showAppearance(userId) {
    const ui = await UiStyleService.get(userId);
    const text = await SettingsUIService.formatAppearanceScreen(ui, userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...MenuService.getSettingsAppearanceMenu(ui)
    });
  }

  async showConnectProviders(userId) {
    const loc = await this.bs.locale(userId);
    return this.bs.sendMessage(
      userId,
      `<b>${t('settings.ai.menu.connect', null, loc)}</b>`,
      { parse_mode: 'HTML', ...(await MenuService.getSettingsAddProviderMenu(loc)) }
    );
  }

  async showCustomAiEdit(userId, providerId) {
    const provider = await SettingsService.getCustomProvider(providerId);
    if (!provider) return this.showAi(userId);
    const loc = await this.bs.locale(userId);
    return this.bs.sendMessage(
      userId,
      `<b>${provider.label}</b>\n${provider.baseUrl}`,
      { parse_mode: 'HTML', ...(await MenuService.getSettingsCustomAiEditMenu(provider.id, loc)) }
    );
  }

  async handleCustomAiBack(userId) {
    const state = stateManager.get(userId) || {};
    const ret = state.settingsReturn || 'connect';
    await this.bs.clearState(userId);
    if (ret === 'connect') return this.showConnectProviders(userId);
    if (ret === 'custom') {
      const loc = await this.bs.locale(userId);
      return this.bs.sendMessage(
        userId,
        `<b>${t('settings.ai.menu.custom', null, loc)}</b>`,
        { parse_mode: 'HTML', ...(await MenuService.getSettingsAiCustomMenu(loc)) }
      );
    }
    if (ret.startsWith('edit:')) {
      return this.showCustomAiEdit(userId, ret.slice(5));
    }
    return this.showAi(userId);
  }

  async sendCustomAiPrompt(userId, textKey, statePatch = {}) {
    const loc = await this.bs.locale(userId);
    const prev = stateManager.get(userId) || {};
    stateManager.set(userId, { ...prev, ...statePatch });
    return this.bs.sendMessage(
      userId,
      t(textKey, null, loc),
      await MenuService.getSettingsCustomAiWizardNav(loc)
    );
  }

  async showAi(userId, sendOpts = {}) {
    const active = await SettingsService.getActiveProvider();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const configuredIds = await SettingsUIService.getConfiguredProviderIds();
    const locale = await this.bs.locale(userId);
    const text = await SettingsUIService.formatAiScreen(userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsAiMenu(active, autoEnrich, configuredIds, locale))
    }, sendOpts);
  }

  async showGeneral(userId) {
    const tz = await UserSettingsService.getTimezone(userId);
    const chatCleanup = await UserSettingsService.getChatCleanup(userId);
    const locale = await this.bs.locale(userId);
    const text = await SettingsUIService.formatGeneralScreen(userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsGeneralMenu(tz, chatCleanup, locale))
    });
  }

  async showAppearanceNav(userId) {
    const ui = await UiStyleService.get(userId);
    const locale = await this.bs.locale(userId);
    return this.bs.sendMessage(userId, `<b>${locale === 'en' ? 'Navigation' : 'Навигация'}</b>`, {
      parse_mode: 'HTML',
      ...MenuService.getSettingsAppearanceNavMenu(ui)
    });
  }

  async showAiActive(userId, sendOpts = {}) {
    const active = await SettingsService.getActiveProvider();
    const configuredIds = await SettingsUIService.getConfiguredProviderIds();
    const locale = await this.bs.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('settings.ai.menu.active', null, locale)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsAiActiveMenu(active, configuredIds, locale))
    }, sendOpts);
  }

  async showTimezone(userId, sendOpts = {}) {
    const tz = await UserSettingsService.getTimezone(userId);
    const locale = await this.bs.locale(userId);
    return this.bs.sendMessage(userId, `<b>${locale === 'en' ? 'Timezone' : 'Часовой пояс'}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getSettingsTimezoneMenu(tz, locale))
    }, sendOpts);
  }

  async showHelp(userId) {
    const text = await SettingsUIService.formatHelpScreen(await this.bs.locale(userId));
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...MenuService.getSettingsHelpMenu()
    });
  }

  async handleCallback(userId, data) {
    const guestAllowed =
      data === 'menu_settings' ||
      data === 'settings_back_root' ||
      data === 'settings_general' ||
      data === 'settings_appearance' ||
      data === 'settings_appearance_nav' ||
      data === 'settings_ui_toggle_emojis' ||
      data === 'settings_ui_nav_text' ||
      data === 'settings_ui_nav_arrows' ||
      data === 'settings_help' ||
      data === 'settings_language' ||
      data === 'settings_lang_ru' ||
      data === 'settings_lang_en' ||
      data === 'settings_toggle_cleanup' ||
      data === 'settings_timezone' ||
      data === 'settings_tz_manual' ||
      /^settings_tz_/.test(data);

    if (!guestAllowed && !(await this.bs.requireOwner(userId))) return;
    if (guestAllowed && this.bs.getUserRole(userId) === 'guest' && (data === 'settings_ai' || data.startsWith('settings_ai_'))) {
      return this.bs.requireOwner(userId);
    }

    if (data === 'menu_settings' || data === 'settings_back_root') {
      await this.bs.clearState(userId);
      return this.showRoot(userId);
    }

    if (data === 'settings_ai') {
      await this.bs.clearState(userId);
      return this.showAi(userId);
    }

    if (data === 'settings_general') {
      await this.bs.clearState(userId);
      return this.showGeneral(userId);
    }

    if (data === 'settings_appearance') {
      await this.bs.clearState(userId);
      return this.showAppearance(userId);
    }

    if (data === 'settings_appearance_nav') {
      return this.showAppearanceNav(userId);
    }

    if (data === 'settings_ui_toggle_emojis') {
      const ui = await UserSettingsService.getUiStyle(userId);
      await UserSettingsService.setUiStyle(userId, { useEmojis: !ui.useEmojis });
      ChatCleanupService.clearReplyKeyboard(userId);
      await this.bs.ensureReplyMenuKeyboard(userId, true);
      return this.showAppearance(userId);
    }

    if (data === 'settings_ui_nav_text') {
      await UserSettingsService.setUiStyle(userId, { navStyle: 'text' });
      return this.showAppearanceNav(userId);
    }

    if (data === 'settings_ui_nav_arrows') {
      await UserSettingsService.setUiStyle(userId, { navStyle: 'arrows' });
      return this.showAppearanceNav(userId);
    }

    if (data === 'settings_help') {
      await this.bs.clearState(userId);
      return this.showHelp(userId);
    }

    if (data === 'settings_language') {
      const loc = await UserSettingsService.getLocale(userId);
      return this.bs.sendMessage(
        userId,
        `<b>${t('settings.language', null, loc)}</b>`,
        { parse_mode: 'HTML', ...(await MenuService.getSettingsLanguageMenu(loc, loc)) }
      );
    }

    if (data === 'settings_timezone') {
      return this.showTimezone(userId);
    }

    if (data === 'settings_ai_connect' || data === 'settings_ai_add') {
      return this.showConnectProviders(userId);
    }

    if (data === 'settings_ai_active') {
      return this.showAiActive(userId);
    }

    if (data === 'settings_ai_custom_back') {
      return this.handleCustomAiBack(userId);
    }

    if (data === 'settings_ai_custom') {
      const loc = await this.bs.locale(userId);
      return this.bs.sendMessage(
        userId,
        `<b>${t('settings.ai.menu.custom', null, loc)}</b>`,
        { parse_mode: 'HTML', ...(await MenuService.getSettingsAiCustomMenu(loc)) }
      );
    }

    if (data === 'settings_lang_ru' || data === 'settings_lang_en') {
      const newLoc = data === 'settings_lang_en' ? 'en' : 'ru';
      await UserSettingsService.setLocale(userId, newLoc);
      const label = t(newLoc === 'en' ? 'settings.lang.en' : 'settings.lang.ru', null, newLoc);
      await this.bs.sendMessage(userId, t('settings.lang.changed', { lang: label }, newLoc));
      return this.showGeneral(userId);
    }

    if (data === 'settings_ai_custom_start') {
      return this.sendCustomAiPrompt(userId, 'settings.ai.custom.label_prompt', {
        mode: 'waiting_custom_ai_label',
        customAi: {},
        settingsReturn: 'connect'
      });
    }

    if (data === 'settings_ai_custom_add') {
      return this.sendCustomAiPrompt(userId, 'settings.ai.custom.label_prompt', {
        mode: 'waiting_custom_ai_label',
        customAi: {},
        settingsReturn: 'custom'
      });
    }

    if (data === 'settings_ai_custom_manage') {
      const loc = await this.bs.locale(userId);
      const providers = await SettingsService.getCustomProviders();
      if (!providers.length) {
        return this.sendCustomAiPrompt(userId, 'settings.ai.custom.label_prompt', {
          mode: 'waiting_custom_ai_label',
          customAi: {},
          settingsReturn: 'custom'
        });
      }
      return this.bs.sendMessage(
        userId,
        '✏️ ' + t('settings.ai.custom.edit', null, loc),
        await MenuService.getSettingsCustomAiManageMenu(loc)
      );
    }

    const customEditMatch = data.match(/^settings_ai_custom_edit_(.+)$/);
    if (customEditMatch) {
      return this.showCustomAiEdit(userId, customEditMatch[1]);
    }

    const editFieldMatch = data.match(/^settings_ai_edit_(.+)_(label|url|key|model)$/);
    if (editFieldMatch) {
      const [, providerId, field] = editFieldMatch;
      const provider = await SettingsService.getCustomProvider(providerId);
      if (!provider) return this.showAi(userId);
      const modeMap = {
        label: 'waiting_custom_ai_edit_label',
        url: 'waiting_custom_ai_edit_url',
        key: 'waiting_custom_ai_edit_key',
        model: 'waiting_custom_ai_edit_model'
      };
      const promptKey = {
        label: 'settings.ai.custom.label_prompt',
        url: 'settings.ai.custom.url_prompt',
        key: 'settings.ai.custom.key_prompt',
        model: 'settings.ai.custom.model_prompt'
      }[field];
      return this.sendCustomAiPrompt(userId, promptKey, {
        mode: modeMap[field],
        customAiEdit: { providerId },
        settingsReturn: `edit:${providerId}`
      });
    }

    if (data === 'settings_toggle_cleanup') {
      const current = await UserSettingsService.getChatCleanup(userId);
      await UserSettingsService.setChatCleanup(userId, !current);
      return this.showGeneral(userId);
    }

    if (data === 'settings_ai_toggle_enrich') {
      const current = await SettingsService.getAutoEnrich();
      await SettingsService.setAutoEnrich(!current);
      return this.showAi(userId);
    }

    if (data === 'settings_ai_pick_list') {
      const configuredIds = await SettingsUIService.getConfiguredProviderIds();
      if (configuredIds.length === 0) {
        return this.showConnectProviders(userId);
      }
      const active = await SettingsService.getActiveProvider();
      return this.bs.sendMessage(
        userId,
        'Выберите активную нейросеть:',
        MenuService.getSettingsPickProviderMenu(configuredIds, active)
      );
    }

    const pickMatch = data.match(/^settings_ai_pick_(.+)$/);
    if (pickMatch && pickMatch[1] !== 'list') {
      await SettingsService.setActiveProvider(pickMatch[1]);
      await this.bs.sendMessage(userId, `Активна нейросеть: <b>${AiProviderRegistry.getLabel(pickMatch[1])}</b>`, { parse_mode: 'HTML' });
      return this.showAi(userId);
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

      return this.bs.sendMessage(
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
      const loc = await this.bs.locale(userId);
      const msg = wasCustom ? t('settings.ai.custom.removed', null, loc) : 'Сервис отключён';
      await this.bs.sendMessage(userId, msg + ' ✅');
      return this.showAi(userId);
    }

    const modelMenuMatch = data.match(/^settings_ai_model_menu_(.+)$/);
    if (modelMenuMatch) {
      const providerId = modelMenuMatch[1];
      const provider = AiProviderRegistry.get(providerId);
      if (!provider) return;
      const currentModel = (await SettingsService.getModel(providerId)) || provider.defaultModel;
      return this.bs.sendMessage(
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
      return this.showAi(userId);
    }

    if (data === 'settings_tz_manual') {
      stateManager.set(userId, { mode: 'waiting_timezone', settingsReturn: 'general' });
      return this.bs.sendMessage(userId, 'Введите часовой пояс (например Europe/Moscow или UTC):');
    }

    const tzMatch = data.match(/^settings_tz_(.+)$/);
    if (tzMatch && tzMatch[1] !== 'manual') {
      await UserSettingsService.setTimezone(userId, tzMatch[1]);
      await this.bs.sendMessage(userId, `Часовой пояс: ${tzMatch[1]} ✅`);
      return this.showTimezone(userId);
    }

    return this.showRoot(userId);
  }

  async handleMessageStep(userId, msg, state) {
    if (!SETTINGS_MESSAGE_MODES.has(state.mode)) return false;

    if (state.mode === 'waiting_custom_ai_label') {
      const label = msg.text?.trim();
      if (!label) {
        return this.sendCustomAiPrompt(userId, 'settings.ai.custom.label_prompt', { mode: 'waiting_custom_ai_label' });
      }
      return this.sendCustomAiPrompt(userId, 'settings.ai.custom.url_prompt', {
        mode: 'waiting_custom_ai_url',
        customAi: { label }
      });
    }

    if (state.mode === 'waiting_custom_ai_url') {
      const baseUrl = msg.text?.trim();
      if (!baseUrl || !/^https?:\/\/.+/i.test(baseUrl)) {
        return this.sendCustomAiPrompt(userId, 'settings.ai.custom.url_prompt', { mode: 'waiting_custom_ai_url' });
      }
      const customAi = { ...(state.customAi || {}), baseUrl };
      return this.sendCustomAiPrompt(userId, 'settings.ai.custom.key_prompt', {
        mode: 'waiting_custom_ai_key',
        customAi
      });
    }

    if (state.mode === 'waiting_custom_ai_key') {
      let key = msg.text?.trim();
      if (key === '-') key = '';
      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      const customAi = {
        ...(state.customAi || {}),
        apiKey: key,
        requiresKey: Boolean(key)
      };
      return this.sendCustomAiPrompt(userId, 'settings.ai.custom.model_prompt', {
        mode: 'waiting_custom_ai_model',
        customAi
      });
    }

    if (state.mode === 'waiting_custom_ai_model') {
      const loc = await this.bs.locale(userId);
      const model = msg.text?.trim();
      if (!model) {
        return this.sendCustomAiPrompt(userId, 'settings.ai.custom.model_prompt', { mode: 'waiting_custom_ai_model' });
      }
      const draft = state.customAi || {};
      await this.bs.sendMessage(userId, t('settings.ai.custom.testing', null, loc), {}, { noNav: true, transient: true });
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
        await this.bs.clearState(userId);
        await this.bs.sendMessage(userId, '✅ ' + t('settings.ai.custom.saved', { label: row.label }, loc), {}, { append: true });
        return this.showAi(userId, { append: true });
      } catch (err) {
        const failedId = SettingsService.slugifyLabel(draft.label);
        const existing = await SettingsService.getCustomProvider(failedId);
        if (existing) {
          await SettingsService.removeCustomProvider(existing.id);
          await SecretsService.removeProviderSecret(existing.id);
          await AiProviderRegistry.refreshCustom();
        }
        await this.bs.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
        await this.bs.clearState(userId);
        return this.showAi(userId, { append: true });
      }
    }

    const editModes = [
      'waiting_custom_ai_edit_label',
      'waiting_custom_ai_edit_url',
      'waiting_custom_ai_edit_key',
      'waiting_custom_ai_edit_model'
    ];
    if (editModes.includes(state.mode)) {
      const loc = await this.bs.locale(userId);
      const { providerId } = state.customAiEdit || {};
      const provider = providerId ? await SettingsService.getCustomProvider(providerId) : null;
      if (!provider) {
        await this.bs.clearState(userId);
        return this.showAi(userId);
      }
      const value = msg.text?.trim();
      const editReturn = { customAiEdit: { providerId }, settingsReturn: `edit:${providerId}` };
      if (state.mode === 'waiting_custom_ai_edit_key') {
        if (value === undefined || value === '') {
          return this.sendCustomAiPrompt(userId, 'settings.ai.custom.key_prompt', {
            mode: state.mode,
            ...editReturn
          });
        }
        let key = value === '-' ? '' : value;
        await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
        await SecretsService.setProviderSecret(providerId, { apiKey: key });
        await AiProviderRegistry.refreshCustom();
        const model = (await SettingsService.getModel(providerId)) || provider.defaultModel;
        try {
          await AiProviderRegistry.validateConfig(providerId, { apiKey: key }, model);
        } catch (err) {
          await this.bs.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
          await this.bs.clearState(userId);
          return this.showAi(userId, { append: true });
        }
        await this.bs.clearState(userId);
        await this.bs.sendMessage(userId, '✅ ' + t('settings.ai.custom.updated', { label: provider.label }, loc), {}, { append: true });
        return this.showAi(userId, { append: true });
      }
      if (!value) {
        const promptKey = {
          waiting_custom_ai_edit_label: 'settings.ai.custom.label_prompt',
          waiting_custom_ai_edit_url: 'settings.ai.custom.url_prompt',
          waiting_custom_ai_edit_model: 'settings.ai.custom.model_prompt'
        }[state.mode];
        return this.sendCustomAiPrompt(userId, promptKey, { mode: state.mode, ...editReturn });
      }
      const patch = {};
      if (state.mode === 'waiting_custom_ai_edit_label') patch.label = value;
      if (state.mode === 'waiting_custom_ai_edit_url') {
        if (!/^https?:\/\/.+/i.test(value)) {
          return this.sendCustomAiPrompt(userId, 'settings.ai.custom.url_prompt', {
            mode: state.mode,
            ...editReturn
          });
        }
        patch.baseUrl = value;
      }
      if (state.mode === 'waiting_custom_ai_edit_model') patch.defaultModel = value;
      await this.bs.sendMessage(userId, t('settings.ai.custom.testing', null, loc), {}, { noNav: true, transient: true });
      try {
        const updated = await SettingsService.updateCustomProvider(providerId, patch);
        await AiProviderRegistry.refreshCustom();
        const secrets = await SecretsService.getProviderSecret(providerId);
        const model = patch.defaultModel || (await SettingsService.getModel(providerId)) || updated.defaultModel;
        await AiProviderRegistry.validateConfig(providerId, secrets, model);
        await this.bs.clearState(userId);
        await this.bs.sendMessage(userId, '✅ ' + t('settings.ai.custom.updated', { label: updated.label }, loc), {}, { append: true });
        return this.showAi(userId, { append: true });
      } catch (err) {
        await this.bs.sendMessage(userId, t('settings.ai.custom.fail', { error: err.message }, loc), { parse_mode: 'HTML' }, { append: true });
        await this.bs.clearState(userId);
        return this.showAi(userId, { append: true });
      }
    }

    if (state.mode === 'waiting_ai_secret') {
      const provider = AiProviderRegistry.get(state.providerId);
      if (!provider) {
        await this.bs.clearState(userId);
        return this.bs.sendMessage(userId, 'Сервис не найден.', await MenuService.getMainMenu());
      }

      const value = msg.text?.trim();
      if (!value) {
        return this.bs.sendMessage(userId, 'Отправьте значение текстом.');
      }

      await ChatCleanupService.deleteUserMessage(this.bot, msg.chat.id, msg.message_id);
      await this.bs.sendMessage(userId, '⏳ Проверяю подключение, подождите…', {}, { noNav: true, transient: true });

      const fields = { [state.secretField]: value };
      await SecretsService.setProviderSecret(state.providerId, fields);

      const model = (await SettingsService.getModel(state.providerId)) || provider.defaultModel;
      const locale = await this.bs.locale(userId);
      const autoEnrich = await SettingsService.getAutoEnrich();

      try {
        await AiProviderRegistry.validateConfig(state.providerId, fields, model);
        await SettingsService.setActiveProvider(state.providerId);
        const masked = SecretsService.maskSecret(value);
        const configuredIds = await SettingsUIService.getConfiguredProviderIds();
        await this.bs.sendMessage(
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
          await this.bs.sendMessage(userId, errText, {
            parse_mode: 'HTML',
            ...(await MenuService.getSettingsAiMenu(await SettingsService.getActiveProvider(), autoEnrich, ids, locale))
          }, { append: true });
        } catch (sendErr) {
          console.error('[SettingsHandlers] AI connect error UI failed:', sendErr.message);
          await this.bs.sendMessage(
            userId,
            `❌ Не удалось подключить ${provider.label}. ${err?.message || sendErr.message}`,
            await MenuService.getSettingsAiMenu(await SettingsService.getActiveProvider(), autoEnrich, ids, locale),
            { append: true, noNav: true }
          );
        }
      }

      await this.bs.clearState(userId);
      return;
    }

    if (state.mode === 'waiting_timezone') {
      const tz = msg.text?.trim();
      if (!tz) return this.bs.sendMessage(userId, 'Укажите часовой пояс.');
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
      } catch {
        return this.bs.sendMessage(userId, 'Неверный часовой пояс. Пример: Europe/Moscow');
      }
      await UserSettingsService.setTimezone(userId, tz);
      await this.bs.clearState(userId);
      await this.bs.sendMessage(userId, `Часовой пояс: ${tz} ✅`);
      return this.showTimezone(userId);
    }

    return false;
  }
}

module.exports = SettingsHandlers;
