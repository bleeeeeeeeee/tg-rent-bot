const SYSTEM_PROMPT =
  'Ты помощник редактора Telegram-канала. По тексту поста верни JSON: title (до 80 символов), mainIdea (до 200 символов), tags (массив 3-7 коротких тегов), category (одна категория: новость, анонс, мнение, обзор, инструкция, другое), keywords (массив 3-10 ключевых слов). Только JSON.';

function parseSummaryResponse(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
  return {
    title: String(parsed.title || '').slice(0, 120),
    mainIdea: String(parsed.mainIdea || parsed.main_idea || '').slice(0, 300),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t).slice(0, 40)).slice(0, 7)
      : [],
    category: String(parsed.category || '').slice(0, 60),
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k).slice(0, 40)).slice(0, 10)
      : []
  };
}

function truncateText(text, max = 4000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

module.exports = { SYSTEM_PROMPT, parseSummaryResponse, truncateText };
