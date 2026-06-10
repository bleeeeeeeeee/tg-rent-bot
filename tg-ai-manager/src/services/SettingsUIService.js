const AiProviderRegistry = require('../ai/AiProviderRegistry');
const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const { t } = require('../i18n');

class SettingsUIService {
  static _escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  static async _loc() {
    return SettingsService.getLocale();
  }

  static _onOff(val, loc, feminine = false) {
    if (feminine) return t(val ? 'settings.on_f' : 'settings.off_f', null, loc);
    return t(val ? 'settings.on' : 'settings.off', null, loc);
  }

  static async formatSettingsRoot() {
    const loc = await this._loc();
    const tz = await SettingsService.getTimezone();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const chatCleanup = await SettingsService.getChatCleanup();
    const active = await SettingsService.getActiveProvider();
    let aiLine = t('settings.root.ai_none', null, loc);

    if (active) {
      const secrets = await SecretsService.getProviderSecret(active);
      if (AiProviderRegistry.isConfigured(active, secrets)) {
        aiLine = t('settings.root.ai_line', { name: AiProviderRegistry.getLabel(active) }, loc);
      }
    }

    return (
      `⚙️ <b>${t('settings.root.title', null, loc)}</b>\n\n` +
      `${aiLine}\n` +
      `${t('settings.root.auto_enrich', { state: this._onOff(autoEnrich, loc) }, loc)}\n` +
      `${t('settings.root.chat_cleanup', { state: this._onOff(chatCleanup, loc, true) }, loc)}\n` +
      `${t('settings.root.timezone', { tz }, loc)}\n\n` +
      t('settings.root.hint', null, loc)
    );
  }

  static async formatAiScreen() {
    const loc = await this._loc();
    const active = await SettingsService.getActiveProvider();
    const autoEnrich = await SettingsService.getAutoEnrich();
    const configured = [];

    for (const p of AiProviderRegistry.listAll()) {
      const secrets = await SecretsService.getProviderSecret(p.id);
      if (AiProviderRegistry.isConfigured(p.id, secrets)) configured.push(p);
    }

    const lines = [`🤖 <b>${t('settings.ai.title', null, loc)}</b>`, '', t('settings.ai.intro', null, loc), ''];

    if (active && configured.some((p) => p.id === active)) {
      const model = await SettingsService.getModel(active);
      lines.push(t('settings.ai.active', { name: AiProviderRegistry.getLabel(active) }, loc));
      if (model) lines.push(t('settings.ai.model', { model }, loc));
    } else if (configured.length > 0) {
      lines.push(t('settings.ai.no_service', null, loc));
    } else {
      lines.push(t('settings.ai.no_connected', null, loc));
    }

    lines.push(t('settings.ai.auto', { state: this._onOff(autoEnrich, loc) }, loc));
    lines.push(t('settings.ai.count', { count: configured.length }, loc));
    return lines.join('\n');
  }

  static async formatAppearanceScreen(ui) {
    const loc = await this._loc();
    const useEmojis = ui?.useEmojis !== false;
    const navStyle = ui?.navStyle === 'arrows' ? 'arrows' : 'text';
    const navExample =
      navStyle === 'arrows' ? '← · ☰ · →' : loc === 'en' ? 'Back · Steps · Next' : '← Назад · К шагам · Далее →';
    return (
      `🎨 <b>${t('settings.appearance.title', null, loc)}</b>\n\n` +
      `${t('settings.appearance.emojis', { state: t(useEmojis ? 'settings.appearance.emojis_on' : 'settings.appearance.emojis_off', null, loc) }, loc)}\n` +
      `${t('settings.appearance.nav', { state: t(navStyle === 'arrows' ? 'settings.appearance.nav_arrows' : 'settings.appearance.nav_text', null, loc) }, loc)}\n` +
      `<code>${navExample}</code>`
    );
  }

  static async formatGeneralScreen() {
    const loc = await this._loc();
    const tz = await SettingsService.getTimezone();
    const chatCleanup = await SettingsService.getChatCleanup();
    return (
      `🌍 <b>${t('settings.general.title', null, loc)}</b>\n\n` +
      `${t('settings.general.cleanup', { state: this._onOff(chatCleanup, loc, true) }, loc)}\n` +
      `${t('settings.general.cleanup_hint', null, loc)}\n\n` +
      `${t('settings.general.tz', null, loc)}\n<b>${tz}</b>`
    );
  }

  static async formatAiConnectError(err, locale = null) {
    const loc = locale || (await this._loc());
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);

    if (status === 429 || /429|rate limit|too many requests/i.test(msg)) {
      return loc === 'en'
        ? '⏳ <b>Service overloaded</b> (rate limit). Wait 1–2 min and retry.'
        : '⏳ <b>Сервис временно перегружен</b> (лимит запросов). Подождите 1–2 минуты.';
    }
    if (status === 404 || /404|no endpoints found/i.test(msg)) {
      return loc === 'en'
        ? '❌ <b>Model unavailable</b> on this service.'
        : '❌ <b>Модель недоступна</b> на этом сервисе.';
    }
    if (status === 401 || status === 403 || /invalid.*key|unauthorized|authentication/i.test(msg)) {
      return loc === 'en' ? '❌ <b>Invalid API key.</b>' : '❌ <b>Неверный ключ API.</b>';
    }
    if (/timeout|ETIMEDOUT|ECONNRESET|timed out/i.test(msg)) {
      return loc === 'en' ? '⏳ <b>No response.</b> Check network.' : '⏳ <b>Нет ответа от сервиса.</b>';
    }
    if (/connection error|ECONNREFUSED|ENOTFOUND|fetch failed|unable to connect|network/i.test(msg)) {
      return loc === 'en'
        ? '❌ <b>Cannot reach server.</b> If this is Ollama on your Mac and the bot runs in the cloud, use a tunnel (ngrok) instead of 127.0.0.1.'
        : '❌ <b>Не удалось подключиться к серверу.</b>\n\n' +
            'Если это <b>Ollama на Mac</b>, а бот на Northflank — адрес <code>127.0.0.1</code> не сработает (это localhost сервера в облаке, не ваш Mac).\n\n' +
            'Варианты:\n' +
            '• Запустить бота локально на Mac (<code>npm start</code>), Northflank выключить\n' +
            '• Или пробросить Ollama через ngrok и указать его URL\n' +
            '• Или использовать облачный AI (OpenRouter, Groq)';
    }
    return `❌ ${SettingsUIService._escapeHtml(msg)}`;
  }

  static async formatHelpScreen(locale = null) {
    const loc = locale || (await this._loc());
    if (loc === 'en') {
      return (
        '📖 <b>Help</b>\n\n' +
        '<b>Main menu</b> — publish, drafts, history, settings.\n' +
        '<b>Admin</b> — /admin (owner + master password): access, cloud, backup.\n\n' +
        '<b>Commands</b>\n/start · /settings · /admin · /stats · /pinchannel'
      );
    }
    return (
      '📖 <b>Инструкция</b>\n\n' +
      '<b>Главное меню</b> — публикация, черновики, история, настройки.\n' +
      '<b>Админка</b> — /admin (владелец + мастер-пароль): доступ, облако, backup.\n\n' +
      '<b>Команды</b>\n/start · /settings · /admin · /stats · /pinchannel'
    );
  }

  static async getConfiguredProviderIds() {
    const ids = [];
    for (const p of AiProviderRegistry.listAll()) {
      const secrets = await SecretsService.getProviderSecret(p.id);
      if (AiProviderRegistry.isConfigured(p.id, secrets)) ids.push(p.id);
    }
    return ids;
  }
}

module.exports = SettingsUIService;
