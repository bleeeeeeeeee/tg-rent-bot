const TOPIC_SYSTEM_PROMPT = `Ты редактор Telegram-канала. Предлагай идеи для будущих публикаций.

Правила:
1. Темы должны быть конкретными, пригодными для поста в Telegram (не абстрактные «о моде», а угол и повод).
2. Язык — русский, естественный для канала.
3. Не повторяй темы из списка «Уже было в канале» и «Уже предлагали ранее».
4. Для режима similar — сохраняй стиль, тон и тип контента канала, но не копируй формулировки один в один.
5. Для режима unique — предлагай свежие углы, которых ещё не было.
6. Не выдумывай факты о конкретных событиях — только идеи и форматы.

Формат ответа — только JSON:
{
  "topics": [
    {
      "title": "короткий заголовок темы",
      "brief": "1–2 предложения: о чём пост и какой угол",
      "angle": "уникальный заход одной фразой",
      "tags": ["тег1", "тег2"]
    }
  ]
}`;

function extractJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return '{}';
  if (text.startsWith('{')) return text;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : '{}';
}

function parseTopicResponse(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(extractJson(raw)) : raw;
  const topics = Array.isArray(parsed?.topics) ? parsed.topics : [];
  return topics
    .map((t) => ({
      title: String(t.title || t.topic || '').trim(),
      brief: String(t.brief || t.description || '').trim(),
      angle: String(t.angle || '').trim(),
      tags: Array.isArray(t.tags) ? t.tags.map(String).filter(Boolean).slice(0, 5) : []
    }))
    .filter((t) => t.title && t.brief);
}

function buildTopicUserPrompt({ mode, count, channelContext, usedTopics, referencePosts, direction }) {
  const lines = [`Режим: ${mode === 'unique' ? 'уникальные темы (новые для канала)' : 'темы в стиле канала (схожие с прошлыми)'}`];
  lines.push(`Количество тем: ${count}`);

  if (direction?.trim()) {
    lines.push(`\nНаправление / тематика / тип контента (приоритет):\n${direction.trim()}`);
  }

  if (channelContext?.channelHint) {
    lines.push(`\nО канале:\n${channelContext.channelHint}`);
  }

  if (referencePosts?.length) {
    lines.push('\nПримеры прошлых публикаций (ориентир по стилю):');
    for (const p of referencePosts.slice(0, 8)) {
      const parts = [p.title, p.mainIdea, p.preview].filter(Boolean);
      const tags = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
      lines.push(`- ${parts.join(' — ').slice(0, 220)}${tags}`);
    }
  } else if (channelContext?.recentSummaries?.length) {
    lines.push('\nНедавние темы канала:');
    for (const s of channelContext.recentSummaries.slice(0, 15)) {
      lines.push(`- ${s}`);
    }
  }

  if (usedTopics?.length) {
    lines.push('\nУже предлагали ранее (не повторять):');
    for (const t of usedTopics.slice(0, 30)) {
      lines.push(`- ${t}`);
    }
  }

  lines.push('\nВерни JSON с массивом topics.');
  return lines.join('\n');
}

module.exports = {
  TOPIC_SYSTEM_PROMPT,
  parseTopicResponse,
  buildTopicUserPrompt
};
