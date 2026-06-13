const ExistingPosts = require('./ExistingPosts');
const PostRepository = require('./PostRepository');
const PostGraphService = require('./PostGraphService');
const { shouldHideFromList, getAlbumParts, countAlbumMedia, isEmptyPost } = require('../utils/albumPosts');
const { buildPostUrl } = require('../utils/channelUrl');
const { countEdits, buildEditTimeline, hasEditHistory } = require('../utils/postEditHistory');
const SettingsService = require('./SettingsService');
const UserSettingsService = require('./UserSettingsService');
const { t } = require('../i18n');

const PAGE_SIZE = 8;

const LIFECYCLE_LABELS = {
  active: '',
  edited: '✏️ ',
  deleted: '🗑 '
};

class HistoryService {
  static async _userContext(userId, locale = null) {
    if (userId) {
      return {
        locale: locale || (await UserSettingsService.getLocale(userId)),
        timezone: await UserSettingsService.getTimezone(userId)
      };
    }
    return {
      locale: locale || (await SettingsService.getLocale()),
      timezone: await SettingsService.getTimezone()
    };
  }

  static async getFilterLabel(filter, locale = null) {
    const loc = locale || (await SettingsService.getLocale());
    const key = `history.filter.${filter}`;
    return t(key, null, loc);
  }

  static truncatePreview(text, max = 120, locale = 'ru') {
    if (!text?.trim()) return t('history.no_text', null, locale);
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
  }

  static getDisplayPreview(post) {
    if (post.title?.trim()) return post.title;
    if (post.mainIdea?.trim()) return post.mainIdea;
    return post.post || post.preview || '';
  }

  static formatDate(iso, timezone, locale = 'ru') {
    if (!iso) return '—';
    const locTag = locale === 'en' ? 'en-US' : 'ru-RU';
    return new Date(iso).toLocaleString(locTag, { timeZone: timezone });
  }

  static formatShortDate(iso, timezone, locale = 'ru') {
    if (!iso) return '—';
    const locTag = locale === 'en' ? 'en-US' : 'ru-RU';
    return new Date(iso).toLocaleString(locTag, {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  static _lifecyclePrefix(status) {
    return LIFECYCLE_LABELS[status] || '';
  }

  static _listTitle(post) {
    const id = post.id ?? post.channelMessageId;
    if (post.title?.trim()) return this.truncatePreview(post.title, 42);
    if (post.mainIdea?.trim()) return this.truncatePreview(post.mainIdea, 42);
    const body = post.post || post.preview || '';
    if (body.trim()) return this.truncatePreview(body, 42);
    if (post.media) return `Медиа #${id}`;
    return id ? `Пост #${id}` : 'Без названия';
  }

  static _buildButtonLabel(kind, sortAt, post, timezone) {
    const date = this.formatShortDate(sortAt, timezone);
    const prefix = post.lifecycleStatus ? this._lifecyclePrefix(post.lifecycleStatus) : '';
    const title = this._listTitle(post);
    return prefix ? `${date} · ${prefix}${title}` : `${date} · ${title}`;
  }

  static async _loadDeleted(timezone) {
    const allPosts = await ExistingPosts.getAll();
    const posts = allPosts
      .filter((p) => p.lifecycleStatus === 'deleted')
      .filter((p) => !shouldHideFromList(p, allPosts))
      .filter((p) => !isEmptyPost(p));

    return posts.map((p) => ({
      kind: 'published',
      refId: String(p.id),
      sortAt: p.deletedAt || p.added,
      preview: p.post,
      title: p.title,
      mainIdea: p.mainIdea,
      tags: p.tags,
      category: p.category,
      keywords: p.keywords,
      media: p.media,
      channelMessageId: p.id,
      channelUrl: buildPostUrl(p.id),
      replyTo: p.replyTo,
      replyToMissing: p.replyToMissing,
      lifecycleStatus: p.lifecycleStatus,
      editedAt: p.editedAt,
      deletedAt: p.deletedAt,
      postOriginal: p.postOriginal,
      editHistory: p.editHistory,
      editCount: countEdits(p),
      buttonLabel: this._buildButtonLabel('published', p.deletedAt || p.added, p, timezone)
    }));
  }

  static async _loadPublished(timezone) {
    let allPosts = await ExistingPosts.getAll();
    let posts = allPosts.filter((p) => p.lifecycleStatus !== 'deleted');
    posts = posts.filter((p) => !shouldHideFromList(p, allPosts));
    posts = posts.filter((p) => !isEmptyPost(p));
    return posts.map((p) => ({
      kind: 'published',
      refId: String(p.id),
      sortAt: p.lifecycleStatus === 'deleted' ? p.deletedAt || p.added : p.added,
      preview: p.post,
      title: p.title,
      mainIdea: p.mainIdea,
      tags: p.tags,
      category: p.category,
      keywords: p.keywords,
      media: p.media,
      channelMessageId: p.id,
      channelUrl: buildPostUrl(p.id),
      replyTo: p.replyTo,
      replyToMissing: p.replyToMissing,
      lifecycleStatus: p.lifecycleStatus,
      editedAt: p.editedAt,
      deletedAt: p.deletedAt,
      postOriginal: p.postOriginal,
      editHistory: p.editHistory,
      editCount: countEdits(p),
      buttonLabel: this._buildButtonLabel('published', p.added, p, timezone)
    }));
  }

  static async _loadScheduled(timezone) {
    const pending = await PostRepository.getAllPending();
    return pending.map((p) => ({
      kind: 'scheduled',
      refId: p.id,
      sortAt: p.publishAt,
      publishAt: p.publishAt,
      preview: p.preview,
      media: p.media,
      status: p.status,
      sourceChatId: p.chatId,
      sourceMessageId: p.messageId,
      lifecycleStatus: 'scheduled',
      buttonLabel: this._buildButtonLabel(
        'scheduled',
        p.publishAt,
        { preview: p.preview, id: p.id },
        timezone
      )
    }));
  }

  static _sortItems(items, filter) {
    const copy = [...items];
    if (filter === 'scheduled') {
      copy.sort((a, b) => new Date(a.sortAt) - new Date(b.sortAt));
    } else {
      copy.sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
    }
    return copy;
  }

  static async list({ filter = 'published', page = 0, pageSize = PAGE_SIZE, userId = null } = {}) {
    const { timezone, locale } = await this._userContext(userId);
    let items = [];

    if (filter === 'published' || filter === 'all') {
      items = items.concat(await this._loadPublished(timezone));
    }
    if (filter === 'deleted' || filter === 'all') {
      items = items.concat(await this._loadDeleted(timezone));
    }
    if (filter === 'scheduled' || filter === 'all') {
      items = items.concat(await this._loadScheduled(timezone));
    }

    items = this._sortItems(items, filter);

    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(0, page), pages - 1);
    const slice = items.slice(safePage * pageSize, (safePage + 1) * pageSize);

    const archiveTotal =
      filter === 'published' || filter === 'all'
        ? (await ExistingPosts.getAll()).filter((p) => p.lifecycleStatus !== 'deleted').length
        : null;
    return {
      items: slice,
      total,
      pages,
      page: safePage,
      filter,
      filterLabel: await this.getFilterLabel(filter, locale),
      locale,
      archiveTotal
    };
  }

  static async getItem({ kind, refId }) {
    if (kind === 'published') {
      let p = await ExistingPosts.getById(refId);
      if (!p) return null;
      if (p.albumPrimaryId) {
        p = await ExistingPosts.getById(p.albumPrimaryId);
        if (!p) return null;
      }
      const allPosts = await ExistingPosts.getAll();
      const albumParts = getAlbumParts(p, allPosts);
      const replyContext = await PostGraphService.buildReplyContext(p.id);
      return {
        kind: 'published',
        refId: String(p.id),
        sortAt: p.added,
        preview: p.post,
        title: p.title,
        mainIdea: p.mainIdea,
        tags: p.tags,
        category: p.category,
        keywords: p.keywords,
        media: p.media,
        channelMessageId: p.id,
        channelUrl: buildPostUrl(p.id),
        replyTo: p.replyTo,
        replyToMissing: p.replyToMissing,
        lifecycleStatus: p.lifecycleStatus,
        editedAt: p.editedAt,
        deletedAt: p.deletedAt,
        postOriginal: p.postOriginal,
        editHistory: p.editHistory,
        editCount: countEdits(p),
        albumParts,
        albumMediaCount: countAlbumMedia(p, allPosts),
        replyContext
      };
    }

    if (kind === 'scheduled') {
      const p = await PostRepository.getById(refId);
      if (!p || p.status !== 'pending') return null;
      return {
        kind: 'scheduled',
        refId: p.id,
        sortAt: p.publishAt,
        publishAt: p.publishAt,
        preview: p.preview,
        media: p.media,
        status: p.status,
        sourceChatId: p.chatId,
        sourceMessageId: p.messageId
      };
    }

    return null;
  }

  static formatListHeader(result) {
    const { filterLabel, total, page, pages, locale = 'ru', archiveTotal = null } = result;
    const title = t('history.list.title', null, locale);
    if (total === 0) {
      let empty = `📚 <b>${title}</b>\n\n${t('history.list.mode', { filter: filterLabel }, locale)}\n${t('history.list.empty', null, locale)}`;
      if (archiveTotal != null && archiveTotal > 0) {
        empty += `\n${t('history.list.hidden_in_archive', { count: archiveTotal }, locale)}`;
      } else {
        empty += `\n${t('history.list.sync_hint', null, locale)}`;
      }
      return empty;
    }
    return (
      `📚 <b>${title}</b>\n\n` +
      `${t('history.list.mode', { filter: filterLabel }, locale)}\n` +
      t('history.list.page', { total, page: page + 1, pages }, locale)
    );
  }

  static _formatLifecycleBlock(item, timezone, locale = 'ru') {
    const lines = [];
    if (item.lifecycleStatus === 'edited') {
      const edits = item.editCount || countEdits(item);
      const suffix = edits > 0 ? ` · ${t('history.card.edits_count', { count: edits }, locale)}` : '';
      lines.push(`✏️ <b>${t('history.card.edited', null, locale)}</b>${suffix} · ${this.formatDate(item.editedAt, timezone)}`);
    }
    if (item.lifecycleStatus === 'deleted') {
      lines.push(`🗑 <b>${t('history.card.deleted', null, locale)}</b> · ${this.formatDate(item.deletedAt, timezone)}`);
    }
    return lines;
  }

  static _formatAiBlock(item) {
    const lines = [];
    if (item.category) lines.push(`📂 Категория: ${this._escapeHtml(item.category)}`);
    if (item.tags?.length) lines.push(`🏷 Теги: ${this._escapeHtml(item.tags.join(', '))}`);
    if (item.keywords?.length) lines.push(`🔑 Ключевые слова: ${this._escapeHtml(item.keywords.join(', '))}`);
    return lines;
  }

  static _formatReplyBlock(item) {
    const lines = [];
    const ctx = item.replyContext;
    if (!ctx) return lines;

    if (ctx.post.replyTo) {
      if (ctx.parent) {
        const label = HistoryService.truncatePreview(
          HistoryService.getDisplayPreview(ctx.parent),
          50
        );
        lines.push(`↩️ Ответ на #${ctx.post.replyTo}: ${HistoryService._escapeHtml(label)}`);
      } else if (ctx.parentMissing || ctx.post.replyToMissing) {
        lines.push(`↩️ Ответ на #${ctx.post.replyTo} (не в архиве)`);
      } else {
        lines.push(`↩️ Ответ на #${ctx.post.replyTo}`);
      }
    }

    if (ctx.children?.length) {
      const ids = ctx.children.map((c) => `#${c.id}`).join(', ');
      lines.push(`💬 Ответы (${ctx.children.length}): ${ids}`);
    }

    return lines;
  }

  static async formatPublishedCard(item, locale = null, userId = null) {
    const ctx = await this._userContext(userId, locale);
    const loc = ctx.locale;
    const timezone = ctx.timezone;
    const statusIcon =
      item.lifecycleStatus === 'deleted' ? '🗑' : item.lifecycleStatus === 'edited' ? '✏️' : '✅';
    const lines = [`${statusIcon} <b>${t('history.card.post', { id: item.channelMessageId }, loc)}</b>`, ''];

    lines.push(...this._formatLifecycleBlock(item, timezone, loc));

    if (item.title) lines.push(`<b>${this._escapeHtml(item.title)}</b>`);
    if (item.mainIdea) lines.push(`💡 ${t('history.card.main_idea', null, loc)}: ${this._escapeHtml(item.mainIdea)}`);

    const aiLines = this._formatAiBlock(item);
    if (aiLines.length) {
      lines.push('');
      lines.push(...aiLines);
    }

    lines.push('', `📅 ${t('history.card.added', null, loc)}: ${this.formatDate(item.sortAt, timezone)}`);
    if (item.media) lines.push(`🖼 ${t('history.card.media', null, loc)}: ${item.media.type}`);
    if (item.albumMediaCount > 1) {
      const ids = [item.channelMessageId, ...(item.albumParts || []).map((p) => p.id)];
      lines.push(`🖼 ${t('history.card.album', { count: item.albumMediaCount }, loc)} (${ids.map((id) => `#${id}`).join(', ')})`);
    }

    const replyLines = this._formatReplyBlock(item);
    if (replyLines.length) {
      lines.push('');
      lines.push(...replyLines);
    }

    lines.push('');
    if (item.lifecycleStatus === 'deleted') {
      lines.push('<s>' + (item.preview?.trim()
        ? this._escapeHtml(item.preview)
        : `<i>${t('history.no_text', null, loc)}</i>`) + '</s>');
    } else {
      lines.push(
        item.preview?.trim() ? this._escapeHtml(item.preview) : `<i>${t('history.no_text', null, loc)}</i>`
      );
    }

    if (hasEditHistory(item) && item.postOriginal && item.postOriginal !== item.preview) {
      lines.push(
        '',
        `<i>${t('history.card.was', null, loc)}:</i> ${this._escapeHtml(this.truncatePreview(item.postOriginal, 300, loc))}`
      );
    }

    return lines.join('\n');
  }

  static async formatEditHistoryCard(item, { versionIndex = null } = {}, locale = null, userId = null) {
    const ctx = await this._userContext(userId, locale);
    const loc = ctx.locale;
    const timezone = ctx.timezone;
    const timeline = buildEditTimeline({
      post: item.preview,
      postOriginal: item.postOriginal,
      editHistory: item.editHistory,
      added: item.sortAt,
      editedAt: item.editedAt,
      lifecycleStatus: item.lifecycleStatus
    });

    const lines = [
      `📜 <b>${t('history.edits.title', { id: item.channelMessageId }, loc)}</b>`,
      '',
      t('history.edits.count', { count: Math.max(0, timeline.length - 1) }, loc),
      ''
    ];

    timeline.forEach((entry, idx) => {
      const label =
        entry.kind === 'original'
          ? t('history.edits.original', null, loc)
          : entry.kind === 'current'
            ? t('history.edits.current', null, loc)
            : t('history.edits.version', { n: idx }, loc);
      const src =
        entry.source && entry.source !== 'current' && entry.source !== 'publish'
          ? ` · ${entry.source}`
          : '';
      lines.push(`<b>${label}</b>${src} · ${this.formatDate(entry.at, timezone)}`);
      const body = this.truncatePreview(entry.post, versionIndex === idx ? 3500 : 400, loc);
      lines.push(this._escapeHtml(body));
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  static getEditVersionCount(item) {
    return buildEditTimeline({
      post: item.preview,
      postOriginal: item.postOriginal,
      editHistory: item.editHistory,
      added: item.sortAt,
      editedAt: item.editedAt,
      lifecycleStatus: item.lifecycleStatus
    }).length;
  }

  static async formatScheduledCard(item, userId = null) {
    const timezone = (await this._userContext(userId)).timezone;
    const lines = ['📅 <b>Запланированный пост</b>', ''];
    lines.push(`⏰ Публикация: ${this.formatDate(item.publishAt, timezone)}`);
    if (item.media) lines.push(`🖼 Медиа: ${item.media.type}`);
    lines.push('');
    lines.push(
      item.preview?.trim() ? this._escapeHtml(item.preview) : '<i>Без текста</i>'
    );
    return lines.join('\n');
  }

  static _escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

module.exports = HistoryService;
