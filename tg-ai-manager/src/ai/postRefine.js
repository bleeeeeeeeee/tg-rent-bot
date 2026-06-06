const { sanitizeTelegramHtml } = require('../utils/telegramHtml');
const { LANGUAGE_PRESETS } = require('./wizardPresets');

const REFINE_SYSTEM_PROMPT = `Ты редактор текста постов для Telegram на русском языке.
Исправь текст по правилам автора. Верни JSON: { "bodyHtml": "..." }.
Сохраняй HTML-разметку Telegram (<b>, <i>, <u>, <s>, <a>, <code>, <pre>, <blockquote>).
Не добавляй пояснений.`;

const STRICT_LANGUAGE_IDS = new Set(['ru_only', 'names_proper', 'names_only']);

function needsLanguageRefine(wizard) {
  if (wizard?.language === 'custom') {
    const note = wizard.languageNote || '';
    return /только рус|без англ|имен/i.test(note);
  }
  return STRICT_LANGUAGE_IDS.has(wizard?.language);
}

function buildRefinePrompt(bodyHtml, wizard) {
  const lang =
    wizard?.language && LANGUAGE_PRESETS[wizard.language]
      ? LANGUAGE_PRESETS[wizard.language].prompt
      : wizard?.languageNote || 'Пиши на русском.';

  return (
    `Правила языка:\n${lang}\n\n` +
    'Исправь пост: убери английские слова там, где они запрещены; ' +
    'исправь кривые калки (many, own, and, Design, stILE, Envoy вместо нормального русского); ' +
    'оставь на латинице только то, что разрешено правилами (имена, бренды).\n\n' +
    `Текст для правки:\n${bodyHtml}`
  );
}

function hasObviousLanguageViolations(html, wizard) {
  if (!needsLanguageRefine(wizard)) return false;
  const plain = String(html).replace(/<[^>]+>/g, ' ');
  const latinWords = plain.match(/\b[a-zA-Z]{2,}\b/g) || [];
  const allowedNames = new Set(
    ['Virgil', 'Abloh', 'Nike', 'Off-White', 'Louis', 'Vuitton', 'Chicago', 'Italy']
      .map((s) => s.toLowerCase())
  );

  for (const word of latinWords) {
    const lower = word.toLowerCase();
    if (allowedNames.has(lower)) continue;
    if (/^[A-Z][a-z]+$/.test(word) && word.length > 2) continue;
    if (['many', 'own', 'and', 'the', 'design', 'style', 'life', 'work', 'world'].includes(lower)) {
      return true;
    }
    if (word.length >= 3 && word === word.toLowerCase()) return true;
  }

  if (/\b[а-яё][a-zA-Z]+|[a-zA-Z]+[а-яё]/i.test(plain.replace(/\s+/g, ''))) return true;
  return latinWords.length > 3;
}

module.exports = {
  REFINE_SYSTEM_PROMPT,
  needsLanguageRefine,
  buildRefinePrompt,
  hasObviousLanguageViolations
};
