const ExistingPosts = require('./ExistingPosts');
const SettingsService = require('./SettingsService');
const WritingService = require('./WritingService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const {
  TOPIC_SYSTEM_PROMPT,
  parseTopicResponse,
  buildTopicUserPrompt
} = require('../ai/topicPrompt');
const HistoryService = require('./HistoryService');

const HISTORY_LIMIT = 200;

class TopicIdeasService {
  static _topicKey(item) {
    return `${item.title}`.trim().toLowerCase();
  }

  static async gatherChannelContext({ limit = 40 } = {}) {
    const posts = (await ExistingPosts.getAll(false))
      .filter((p) => p.lifecycleStatus !== 'deleted')
      .sort((a, b) => new Date(b.added || 0) - new Date(a.added || 0))
      .slice(0, limit);

    const recentSummaries = posts.map((p) => {
      const title = p.title?.trim() || HistoryService.getDisplayPreview(p).slice(0, 80);
      const tags = p.tags?.length ? ` (${p.tags.slice(0, 3).join(', ')})` : '';
      return `${title}${tags}`;
    });

    const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))];
    const allTags = posts.flatMap((p) => p.tags || []);
    const tagFreq = {};
    for (const tag of allTags) tagFreq[tag] = (tagFreq[tag] || 0) + 1;
    const topTags = Object.entries(tagFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t);

    let channelHint = `В архиве ${posts.length} активных публикаций.`;
    if (categories.length) channelHint += ` Категории: ${categories.slice(0, 8).join(', ')}.`;
    if (topTags.length) channelHint += ` Частые теги: ${topTags.join(', ')}.`;

    return { posts, recentSummaries, channelHint, topTags, categories };
  }

  static _mapReferencePost(post) {
    return {
      id: post.id,
      title: post.title?.trim() || '',
      mainIdea: post.mainIdea?.trim() || '',
      tags: post.tags || [],
      category: post.category || '',
      preview: (post.post || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    };
  }

  static async getUsedTopicTitles() {
    const history = await SettingsService.getTopicHistory();
    return history.map((h) => h.title).filter(Boolean);
  }

  static async appendTopicHistory(items, mode) {
    const existing = await SettingsService.getTopicHistory();
    const now = new Date().toISOString();
    const seen = new Set(existing.map((e) => this._topicKey(e)));
    const added = [];

    for (const item of items) {
      const key = this._topicKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({
        title: item.title,
        brief: item.brief,
        mode,
        createdAt: now
      });
    }

    const merged = [...added, ...existing].slice(0, HISTORY_LIMIT);
    await SettingsService.setTopicHistory(merged);
    return added.length;
  }

  static async generateTopics({
    mode = 'unique',
    count = 5,
    referencePostIds = []
  } = {}) {
    const ctx = await WritingService.resolveAi();
    if (!ctx) throw new Error('ИИ не настроен. Подключите сервис в Настройках → ИИ для постов.');

    const channelContext = await this.gatherChannelContext();
    const usedTopics = await this.getUsedTopicTitles();

    let referencePosts = [];
    if (referencePostIds.length) {
      for (const id of referencePostIds) {
        const post = await ExistingPosts.getById(Number(id));
        if (post && post.lifecycleStatus !== 'deleted') {
          referencePosts.push(this._mapReferencePost(post));
        }
      }
    } else if (mode === 'similar' && channelContext.posts.length) {
      const pool = channelContext.posts.slice(0, 20);
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      referencePosts = shuffled.slice(0, 5).map((p) => this._mapReferencePost(p));
    }

    const userPrompt = buildTopicUserPrompt({
      mode,
      count,
      channelContext,
      usedTopics,
      referencePosts
    });

    const raw = await AiProviderRegistry.completeRaw(ctx.providerId, userPrompt, {
      model: ctx.model,
      secrets: ctx.secrets,
      systemPrompt: TOPIC_SYSTEM_PROMPT
    });

    const topics = parseTopicResponse(raw);

    if (!topics.length) {
      throw new Error('ИИ не вернул темы. Попробуйте ещё раз или смените модель.');
    }

    topics = topics.slice(0, count);
    await this.appendTopicHistory(topics, mode);
    return { topics, mode, referencePostIds };
  }

  static formatTopicList(topics, locale = 'ru') {
    return topics
      .map((t, i) => {
        const tags = t.tags?.length ? `\n   🏷 ${t.tags.join(', ')}` : '';
        const angle = t.angle ? `\n   💡 ${t.angle}` : '';
        return `<b>${i + 1}. ${escapeHtml(t.title)}</b>\n${escapeHtml(t.brief)}${angle}${tags}`;
      })
      .join('\n\n');
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = TopicIdeasService;
