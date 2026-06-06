const SettingsService = require('./SettingsService');

const DEFAULT_UI = {
  useEmojis: true,
  navStyle: 'text'
};

const NAV_LABELS = {
  text: {
    back: '← Назад',
    forward: 'Далее →',
    skip: 'Пропустить →',
    edit: 'Изменить',
    steps: 'К шагам',
    done: (n) => (n ? `Готово (${n}) →` : 'Готово →'),
    exit: 'Выйти'
  },
  arrows: {
    back: '←',
    forward: '→',
    skip: '→',
    edit: '✎',
    steps: '☰',
    done: (n) => (n ? `${n} →` : '→'),
    exit: '×'
  }
};

const NAV_LABELS_PLAIN = {
  back: 'Назад',
  forward: 'Далее',
  skip: 'Пропустить',
  edit: 'Изменить',
  steps: 'К шагам',
  done: (n) => (n ? `Готово (${n})` : 'Готово'),
  exit: 'Выйти'
};

class UiStyleService {
  static async get() {
    const stored = await SettingsService.getUiStyle();
    return { ...DEFAULT_UI, ...stored };
  }

  static usesEmojis(ui) {
    return ui?.useEmojis !== false;
  }

  static selectedMark(ui) {
    return this.usesEmojis(ui) ? '✓ ' : '• ';
  }

  static optionalEmoji(ui, emoji, text) {
    if (!this.usesEmojis(ui)) return text;
    return `${emoji} ${text}`;
  }

  static backLabel(ui, text = 'Главное меню') {
    return this.optionalEmoji(ui, '↩️', text);
  }

  static replyMenuLabel(ui) {
    return this.usesEmojis(ui) ? '▶️ Меню' : 'Меню';
  }

  static navLabel(ui, key, arg) {
    const arrows = ui?.navStyle === 'arrows';
    if (!this.usesEmojis(ui) && !arrows) {
      const entry = NAV_LABELS_PLAIN[key];
      return typeof entry === 'function' ? entry(arg) : entry;
    }
    const entry = NAV_LABELS[arrows ? 'arrows' : 'text'][key];
    return typeof entry === 'function' ? entry(arg) : entry;
  }

  static buildWizardNavRow(ui, mode, {
    filled = false,
    editing = false,
    skipCallback,
    mediaCount = 0,
    stylePending = false
  } = {}) {
    const style = ui || DEFAULT_UI;
    const { WIZARD_FLOW } = require('../constants/wizardSteps');
    const canBack = WIZARD_FLOW.indexOf(mode) > 0;
    const row = [];

    if (canBack) {
      row.push({ text: this.navLabel(style, 'back'), callback_data: 'wizard_back' });
    }

    if (filled && !editing) {
      row.push({ text: this.navLabel(style, 'edit'), callback_data: 'wizard_edit' });
    } else {
      row.push({ text: this.navLabel(style, 'steps'), callback_data: 'wizard_steps' });
    }

    if (filled && !editing) {
      row.push({ text: this.navLabel(style, 'forward'), callback_data: 'wizard_keep' });
    } else if (mode === 'wizard_style' && stylePending && !filled && !editing) {
      row.push({ text: this.navLabel(style, 'done'), callback_data: 'wizard_style_done' });
    } else if (mode === 'wizard_media' && mediaCount > 0 && !filled && !editing) {
      row.push({ text: this.navLabel(style, 'done', mediaCount), callback_data: 'wizard_media_done' });
    } else {
      row.push({ text: this.navLabel(style, 'skip'), callback_data: skipCallback });
    }

    return row;
  }

  static wizardFooterRow(ui) {
    const style = ui || DEFAULT_UI;
    return [{ text: this.navLabel(style, 'exit'), callback_data: 'cancel' }];
  }

  static buildWizardKeyboard(ui, mode, options, extraRows = []) {
    const rows = [...extraRows];
    rows.push(this.buildWizardNavRow(ui, mode, options));
    rows.push(this.wizardFooterRow(ui));
    return { reply_markup: { inline_keyboard: rows } };
  }

  static languagePresetLabel(ui, key, text) {
    const emojiMap = {
      ru: '🇷🇺',
      proper: '👤',
      names: '🏷',
      topic: '📚',
      en: '🌐'
    };
    if (!this.usesEmojis(ui)) return text;
    return emojiMap[key] ? `${emojiMap[key]} ${text}` : text;
  }

  static stylePresetLabel(ui, emoji, text) {
    return this.optionalEmoji(ui, emoji, text);
  }
}

module.exports = UiStyleService;
