const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const ChatCleanupService = require('./ChatCleanupService');
const { WRITE_SYSTEM_PROMPT } = require('../ai/writePrompt');
const {
  REFINE_SYSTEM_PROMPT,
  needsLanguageRefine,
  buildRefinePrompt,
  hasObviousLanguageViolations
} = require('../ai/postRefine');
const MediaLib = require('./WizardMediaLibrary');
const { resolveLanguagePolicy, resolvePostStyle, LANGUAGE_PRESETS, STYLE_PRESETS } = require('../ai/wizardPresets');
const { sanitizeTelegramHtml, truncateCaption, captionTooLong } = require('../utils/telegramHtml');
const {
  extractMediaItem,
  isMediaMessage,
  summarizeMediaCollection,
  validateMediaCollection,
  buildSendMediaGroupInput,
  MEDIA_GROUP_MAX,
  CAPTION_MAX_LENGTH
} = require('../utils/telegramMedia');

class WritingService {
  static async _resolveAiForWriting() {
    const AiConfigService = require('./AiConfigService');
    return AiConfigService.resolveForGeneration();
  }

  static async canWrite() {
    const AiConfigService = require('./AiConfigService');
    return AiConfigService.isReady();
  }

  static async resolveAi() {
    return this._resolveAiForWriting();
  }

  static emptyWizard() {
    return {
      title: '',
      brief: '',
      tone: '',
      language: '',
      languageNote: '',
      postStyle: '',
      postStyles: [],
      postStyleNote: '',
      keywords: '',
      mediaPool: [],
      selectedMediaIds: [],
      mediaGalleryPage: 0,
      stagedMedia: [],
      bodyHtml: '',
      previewMessageIds: [],
      regenerateCount: 0
    };
  }

  static hasWizardInput(wizard) {
    if (!wizard) return false;
    return Boolean(
      wizard.title?.trim() ||
      wizard.brief?.trim() ||
      wizard.tone?.trim() ||
      wizard.language?.trim() ||
      wizard.languageNote?.trim() ||
      wizard.postStyle?.trim() ||
      wizard.postStyles?.length ||
      wizard.postStyleNote?.trim() ||
      wizard.keywords?.trim() ||
      wizard.mediaPool?.length ||
      wizard.stagedMedia?.length
    );
  }

  static extractMediaItem(msg) {
    return extractMediaItem(msg);
  }

  static isMediaMessage(msg) {
    return isMediaMessage(msg);
  }

  static getStagedMessageIds(wizard) {
    return (wizard?.stagedMedia || []).map((m) => m.messageId);
  }

  static collectWizardMessageIds(wizard) {
    MediaLib.migrateLegacyMedia(wizard);
    const ids = new Set();
    for (const item of wizard?.stagedMedia || []) {
      if (item.messageId) ids.add(item.messageId);
    }
    for (const item of wizard?.mediaPool || []) {
      if (item.messageId) ids.add(item.messageId);
    }
    if (wizard?.extraPreviewTextId) ids.add(wizard.extraPreviewTextId);
    for (const id of wizard?.previewMessageIds || []) {
      if (id) ids.add(id);
    }
    return [...ids];
  }

  static async releaseStagedMedia(bot, userId, wizard, { clearPool = false } = {}) {
    MediaLib.migrateLegacyMedia(wizard);
    const ids = this.collectWizardMessageIds(wizard);
    for (const messageId of ids) {
      await ChatCleanupService.releasePinnedMessage(bot, userId, messageId);
    }
    wizard.stagedMedia = [];
    wizard.previewMessageIds = [];
    wizard.extraPreviewTextId = null;
    for (const item of wizard?.mediaPool || []) {
      item.messageId = 0;
      item.chatId = 0;
    }
    if (clearPool) MediaLib.clearPool(wizard);
  }

  static async releaseWizardSession(bot, userId, wizard, { clearPool = true } = {}) {
    if (!wizard) return;
    await this.releaseStagedMedia(bot, userId, wizard, { clearPool });
    wizard.mediaPreviewHidden = true;
  }

  static async hideWizardMediaPreview(bot, userId, wizard) {
    await this.releaseStagedMedia(bot, userId, wizard);
    wizard.mediaPreviewHidden = true;
  }

  static async restageWizardMedia(bot, userId, wizard, { captionHtml = null } = {}) {
    const saved = (wizard.stagedMedia || [])
      .filter((i) => i.fileId)
      .map((i) => ({ type: i.type, fileId: i.fileId, media: i.media, poolId: i.poolId }));

    if (!saved.length) return;

    await this.releaseStagedMedia(bot, userId, wizard);

    const check = validateMediaCollection(saved);
    if (!check.ok) throw new Error(check.error);

    const captionTypes = new Set(['photo', 'video', 'animation', 'document', 'audio']);
    const html = captionHtml ? sanitizeTelegramHtml(captionHtml) : null;

    const pinStaged = (messageId, index, item, poolId) => {
      wizard.stagedMedia[index] = {
        messageId,
        chatId: userId,
        type: item.type,
        fileId: item.fileId,
        media: item.media,
        poolId: poolId || item.poolId
      };
      ChatCleanupService.pinMessage(userId, messageId);
    };

    if (saved.length === 1) {
      const item = saved[0];
      const opts = html && captionTypes.has(item.type) ? { parse_mode: 'HTML', caption: html } : {};
      let previewMsg;
      if (item.type === 'photo') previewMsg = await bot.sendPhoto(userId, item.fileId, opts);
      else if (item.type === 'video') previewMsg = await bot.sendVideo(userId, item.fileId, opts);
      else if (item.type === 'animation') previewMsg = await bot.sendAnimation(userId, item.fileId, opts);
      else if (item.type === 'document') previewMsg = await bot.sendDocument(userId, item.fileId, opts);
      else if (item.type === 'audio') previewMsg = await bot.sendAudio(userId, item.fileId, opts);
      else if (item.type === 'voice') previewMsg = await bot.sendVoice(userId, item.fileId);
      else if (item.type === 'video_note') previewMsg = await bot.sendVideoNote(userId, item.fileId);
      else previewMsg = await bot.sendMessage(userId, html || ' ', { parse_mode: 'HTML' });

      wizard.stagedMedia = [];
      pinStaged(previewMsg.message_id, 0, item, item.poolId);

      if (html && !captionTypes.has(item.type)) {
        const textMsg = await bot.sendMessage(userId, html, { parse_mode: 'HTML' });
        ChatCleanupService.pinMessage(userId, textMsg.message_id);
        wizard.extraPreviewTextId = textMsg.message_id;
      } else {
        wizard.extraPreviewTextId = null;
      }
      return previewMsg;
    }

    const mediaInput = buildSendMediaGroupInput(saved, html || '');
    const previewMsgs = await bot.sendMediaGroup(userId, mediaInput);
    wizard.stagedMedia = [];
    previewMsgs.forEach((m, i) => pinStaged(m.message_id, i, saved[i], saved[i].poolId));
    wizard.extraPreviewTextId = null;
    MediaLib.applyRestagedMessages(wizard, wizard.stagedMedia);
    wizard.mediaPreviewHidden = false;
    return previewMsgs[0];
  }

  static getWizardPinnedIds(wizard) {
    const ids = [];
    if (wizard?.stagedMedia?.length) {
      ids.push(...wizard.stagedMedia.map((m) => m.messageId).filter(Boolean));
    }
    if (wizard?.extraPreviewTextId) ids.push(wizard.extraPreviewTextId);
    if (wizard?.previewMessageIds?.length) {
      for (const id of wizard.previewMessageIds) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  static wizardDraftLabel(wizard) {
    return (
      wizard?.title?.trim() ||
      wizard?.brief?.trim()?.slice(0, 40) ||
      (wizard?.stagedMedia?.length ? 'Пост с медиа' : 'Мастер ИИ')
    );
  }

  static _escapeStepText(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  static _truncateStepText(text, max = 280) {
    const s = String(text || '').trim();
    if (s.length <= max) return s;
    return `${s.slice(0, max)}…`;
  }

  static formatMediaSummary(stagedMedia) {
    if (!stagedMedia?.length) return '';
    const labels = {
      photo: 'фото',
      video: 'видео',
      animation: 'GIF',
      document: 'документ',
      audio: 'аудио',
      voice: 'голосовое',
      video_note: 'кружок'
    };
    const counts = {};
    for (const item of stagedMedia) {
      const key = labels[item.type] || item.type;
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([label, n]) => `${n} ${label}`)
      .join(', ');
  }

  static isStepFilled(mode, wizard) {
    return this.formatStepSummary(mode, wizard).filled;
  }

  static formatStepSummary(mode, wizard) {
    if (!wizard) return { filled: false, text: '' };

    switch (mode) {
      case 'wizard_title':
        return wizard.title?.trim()
          ? { filled: true, text: wizard.title.trim() }
          : { filled: false, text: '' };
      case 'wizard_brief':
        return wizard.brief?.trim()
          ? { filled: true, text: wizard.brief.trim() }
          : { filled: false, text: '' };
      case 'wizard_tone':
        return wizard.tone?.trim()
          ? { filled: true, text: wizard.tone.trim() }
          : { filled: false, text: '' };
      case 'wizard_keywords':
        return wizard.keywords?.trim()
          ? { filled: true, text: wizard.keywords.trim() }
          : { filled: false, text: '' };
      case 'wizard_language':
        if (wizard.language === 'custom' && wizard.languageNote?.trim()) {
          return { filled: true, text: wizard.languageNote.trim() };
        }
        if (wizard.language && LANGUAGE_PRESETS[wizard.language]) {
          return { filled: true, text: LANGUAGE_PRESETS[wizard.language].label };
        }
        return { filled: false, text: '' };
      case 'wizard_style': {
        const parts = [];
        if (wizard.postStyles?.length) {
          parts.push(...wizard.postStyles.map((id) => STYLE_PRESETS[id]?.label).filter(Boolean));
        } else if (wizard.postStyle && STYLE_PRESETS[wizard.postStyle]) {
          parts.push(STYLE_PRESETS[wizard.postStyle].label);
        }
        if (wizard.postStyleNote?.trim()) parts.push(wizard.postStyleNote.trim());
        if (!parts.length) return { filled: false, text: '' };
        return { filled: true, text: parts.join('\n') };
      }
      case 'wizard_media': {
        MediaLib.migrateLegacyMedia(wizard);
        if (!wizard.mediaPool?.length) return { filled: false, text: '' };
        return { filled: true, text: MediaLib.formatPoolSummary(wizard, { forPre: true }) };
      }
      default:
        return { filled: false, text: '' };
    }
  }

  static formatWizardProgress(wizard, { exclude = [] } = {}) {
    if (!wizard) return '';
    const lines = [];
    if (wizard.title?.trim()) lines.push(`title: ${wizard.title.trim()}`);
    if (wizard.brief?.trim()) lines.push(`brief: ${wizard.brief.trim()}`);
    if (wizard.tone?.trim()) lines.push(`tone: ${wizard.tone.trim()}`);
    if (wizard.language && LANGUAGE_PRESETS[wizard.language]) {
      lines.push(`language: ${LANGUAGE_PRESETS[wizard.language].label}`);
    } else if (wizard.languageNote?.trim()) {
      lines.push(`language: ${wizard.languageNote.trim()}`);
    }
    const style = this.formatStepSummary('wizard_style', wizard);
    if (style.filled) lines.push(`style:\n${style.text}`);
    MediaLib.migrateLegacyMedia(wizard);
    if (!exclude.includes('media') && wizard.mediaPool?.length) {
      lines.push(`media:\n${MediaLib.formatPoolSummary(wizard, { forPre: true })}`);
    }
    if (wizard.keywords?.trim()) lines.push(`keywords: ${wizard.keywords.trim()}`);
    if (!lines.length) return '';
    return `\n\n<b>Уже введено</b> <i>(можно копировать)</i>:\n<pre>${this._escapeStepText(lines.join('\n\n'))}</pre>`;
  }

  static formatStepMessage(basePrompt, mode, wizard, { editing = false, revisit = false } = {}) {
    const summary = this.formatStepSummary(mode, wizard);
    let text = basePrompt;
    if (editing) {
      text += '\n\n✏️ <b>Отправьте новое значение</b> (или выберите вариант кнопкой):';
    } else if (summary.filled && revisit) {
      text += `\n\n<b>Заполнено</b> <i>(можно копировать)</i>:\n<pre>${this._escapeStepText(this._truncateStepText(summary.text, 900))}</pre>`;
    }
    text += this.formatWizardProgress(wizard);
    return text;
  }

  static buildUserPrompt(wizard) {
    const parts = [];
    if (wizard.title?.trim()) parts.push(`Тема / название: ${wizard.title.trim()}`);
    if (wizard.brief?.trim()) parts.push(`О чём написать: ${wizard.brief.trim()}`);
    if (wizard.tone?.trim()) parts.push(`Тон: ${wizard.tone.trim()}`);
    parts.push(resolveLanguagePolicy(wizard));
    parts.push(resolvePostStyle(wizard));
    if (wizard.keywords?.trim()) parts.push(`Ключевые слова и теги: ${wizard.keywords.trim()}`);
    const count = wizard.stagedMedia?.length || 0;
    if (count && parts.length === 0) {
      parts.push('Создай подпись к посту с медиа для Telegram-канала.');
    }
    if (count) {
      parts.push(
        `К посту будет прикреплено медиа (${count} файл${count === 1 ? '' : count < 5 ? 'а' : 'ов'}) — ` +
          `текст пойдёт в подпись (до ${CAPTION_MAX_LENGTH} символов).`
      );
    }
    return parts.join('\n');
  }

  static async generatePost(wizard) {
    const ctx = await this._resolveAiForWriting();
    if (!ctx) throw new Error('ИИ не настроен. Подключите сервис в Настройках → ИИ для постов.');

    const userPrompt = this.buildUserPrompt(wizard);
    let { bodyHtml } = await AiProviderRegistry.generate(ctx.providerId, userPrompt, {
      model: ctx.model,
      secrets: ctx.secrets,
      systemPrompt: WRITE_SYSTEM_PROMPT
    });

    let html = sanitizeTelegramHtml(bodyHtml);

    if (needsLanguageRefine(wizard) && hasObviousLanguageViolations(html, wizard)) {
      try {
        const refined = await AiProviderRegistry.generate(
          ctx.providerId,
          buildRefinePrompt(html, wizard),
          {
            model: ctx.model,
            secrets: ctx.secrets,
            systemPrompt: REFINE_SYSTEM_PROMPT
          }
        );
        html = sanitizeTelegramHtml(refined.bodyHtml || html);
      } catch {
        /* keep first pass */
      }
    }

    if (wizard.stagedMedia?.length && captionTooLong(html)) {
      html = truncateCaption(html);
    }
    return html;
  }

  static async releasePreview(bot, userId, wizard) {
    if (!wizard) return;
    const ids = [...(wizard.previewMessageIds || [])];
    if (wizard.extraPreviewTextId) ids.push(wizard.extraPreviewTextId);
    for (const id of ids) {
      if (id) await ChatCleanupService.releasePinnedMessage(bot, userId, id);
    }
    wizard.extraPreviewTextId = null;
    wizard.previewMessageIds = [];
  }

  static async sendPreview(bot, userId, wizard, bodyHtml) {
    const html = sanitizeTelegramHtml(bodyHtml);
    wizard.bodyHtml = html;
    const items = wizard.stagedMedia || [];

    if (items.length === 0) {
      await this.releasePreview(bot, userId, wizard);
      const previewMsg = await bot.sendMessage(userId, html, { parse_mode: 'HTML' });
      ChatCleanupService.pinMessage(userId, previewMsg.message_id);
      wizard.previewMessageIds = [previewMsg.message_id];
      return previewMsg;
    }

    await this.releasePreview(bot, userId, wizard);
    const previewMsg = await this.restageWizardMedia(bot, userId, wizard, { captionHtml: html });
    wizard.previewMessageIds = wizard.stagedMedia.map((m) => m.messageId);
    if (wizard.extraPreviewTextId) {
      wizard.previewMessageIds.push(wizard.extraPreviewTextId);
    }
    return previewMsg;
  }

  static formatMediaStepHint(wizard = null, { editing = false } = {}) {
    MediaLib.migrateLegacyMedia(wizard);
    const poolTotal = wizard?.mediaPool?.length || 0;
    const selected = wizard?.selectedMediaIds?.length || 0;

    let text =
      `Шаг 6/7. Отправьте медиа — в <b>пост</b> до <b>${MEDIA_GROUP_MAX}</b> файлов (лимит Telegram). ` +
      `Все файлы сохраняются в библиотеке — выберите, что публиковать.`;
    if (editing && poolTotal === 0) {
      text += '\n\n✏️ <b>Отправьте файлы</b> или «Пропустить →», чтобы убрать медиа.';
      text += this.formatWizardProgress(wizard, { exclude: ['media'] });
      return text;
    }

    if (poolTotal > 0) {
      text += `\n\n<pre>${this._escapeStepText(MediaLib.formatPoolSummary(wizard, { forPre: true }))}</pre>`;
      text += `\n\nВыберите номера кнопками ниже. В посте: <b>${selected}/${MEDIA_GROUP_MAX}</b>.`;
    } else {
      text += '\n\nМожно отправлять несколько сообщений и альбомами.';
    }
    text += this.formatWizardProgress(wizard, { exclude: ['media'] });
    return text;
  }

  static formatGenerateError(err) {
    const msg = err?.message || String(err);
    if (/429|rate limit|too many/i.test(msg)) {
      return 'Лимит запросов к ИИ. Подождите 1–2 минуты и повторите.';
    }
    if (/timeout|timed out/i.test(msg)) {
      return 'ИИ не ответил вовремя. Попробуйте ещё раз или отредактируйте текст вручную.';
    }
    return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
  }
}

module.exports = WritingService;
