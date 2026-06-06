const LANGUAGE_PRESETS = {
  ru_only: {
    label: 'Только русский',
    prompt:
      'Пиши полностью на русском. Никаких английских слов, кроме имён и брендов, которые нельзя перевести (Virgil Abloh, Nike). ' +
      'Не транслитерируй английские слова кириллицей.'
  },
  names_proper: {
    label: 'Только имена (люди, места)',
    prompt:
      'Пиши полностью на русском. На латинице — только имена и фамилии людей, названия городов и стран. ' +
      'Запрещены английские обычные слова (many, own, design, style, life, work, world, and, the). ' +
      'Бренды и термины — по-русски или транслитом, если нет устоявшейся формы.'
  },
  names_only: {
    label: 'Бренды и названия',
    prompt:
      'Основной текст — русский. На латинице — только бренды, компании, коллекции, официальные названия продуктов и событий. ' +
      'Запрещены английские обычные слова (many, own, design, style, clothing, enthusiast). ' +
      'Пиши «мода», «коллекция», «дизайн», «стиль» — не moda, collections, Design, stILE.'
  },
  topic_terms: {
    label: 'По теме — уместные термины',
    prompt:
      'Основной язык — русский. Иностранные и английские термины допустимы только если они уместны по теме поста ' +
      '(high fashion, streetwear, collab) и обычно так употребляются в этой нише. ' +
      'Каждый термин — осмысленно; не смешивай языки в одном предложении без причины.'
  },
  bilingual: {
    label: 'Можно много английского',
    prompt:
      'Допускается свободное смешение русского и английского, если это уместно для аудитории канала. ' +
      'Всё равно избегай кривых калек и бессмысленных вставок.'
  }
};

const STYLE_PRESETS = {
  short: {
    label: 'Короткий',
    prompt: 'Короткий пост: 2–4 абзаца, без воды, сразу к сути.'
  },
  story: {
    label: 'История',
    prompt: 'Повествование: завязка → развитие → вывод. Читается как мини-история, не как справочник.'
  },
  facts: {
    label: 'Факты и тезисы',
    prompt: 'Структура фактов и тезисов: можно маркированный список, конкретные даты и имена, минимум общих фраз.'
  },
  expert: {
    label: 'Экспертный разбор',
    prompt: 'Экспертный тон: аргументы, контекст, выводы. Без пустых восклицаний и клише.'
  },
  casual: {
    label: 'Разговорный',
    prompt: 'Живой разговорный тон, как для подписчиков в ленте. Допустимы эмодзи умеренно, если тон шага 3 не запрещает.'
  }
};

const DEFAULT_LANGUAGE_PROMPT =
  'Пиши на русском. Имена и бренды — в принятой форме. Не вставляй английские слова без необходимости.';

const DEFAULT_STYLE_PROMPT =
  'Обычный пост для Telegram: связный текст, 3–6 абзацев, без шаблонных клише и пустых вопросов в каждом абзаце.';

function resolveLanguagePolicy(wizard) {
  if (wizard?.language === 'custom' && wizard.languageNote?.trim()) {
    return `Язык и иностранные слова (задано автором): ${wizard.languageNote.trim()}`;
  }
  if (wizard?.language && LANGUAGE_PRESETS[wizard.language]) {
    return `Язык и иностранные слова: ${LANGUAGE_PRESETS[wizard.language].prompt}`;
  }
  return `Язык и иностранные слова (по умолчанию): ${DEFAULT_LANGUAGE_PROMPT}`;
}

function resolvePostStyle(wizard) {
  const parts = [];
  if (wizard?.postStyles?.length) {
    const labels = wizard.postStyles
      .map((id) => STYLE_PRESETS[id]?.prompt)
      .filter(Boolean);
    if (labels.length) parts.push(`Особенность поста: ${labels.join(' ')}`);
  } else if (wizard?.postStyle && STYLE_PRESETS[wizard.postStyle]) {
    parts.push(`Особенность поста: ${STYLE_PRESETS[wizard.postStyle].prompt}`);
  }
  if (wizard?.postStyleNote?.trim()) {
    parts.push(`Дополнительно от автора: ${wizard.postStyleNote.trim()}`);
  } else if (wizard?.postStyle === 'custom' && wizard?.postStyleCustom?.trim()) {
    parts.push(`Особенность поста (задано автором): ${wizard.postStyleCustom.trim()}`);
  }
  if (parts.length) return parts.join('\n');
  return `Особенность поста (по умолчанию): ${DEFAULT_STYLE_PROMPT}`;
}

module.exports = {
  LANGUAGE_PRESETS,
  STYLE_PRESETS,
  resolveLanguagePolicy,
  resolvePostStyle
};
