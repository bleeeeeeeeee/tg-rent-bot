const { WIZARD_FLOW } = require('./wizardSteps');

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
  'wizard_generate_error',
  'wizard_generating'
]);

module.exports = {
  WIZARD_STEP_INFO,
  WIZARD_LANG_PRESETS,
  WIZARD_STYLE_PRESETS,
  WIZARD_MODES
};
