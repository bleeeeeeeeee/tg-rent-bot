const HistoryService = require('../services/HistoryService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const ChannelSyncService = require('../services/ChannelSyncService');
const ChannelPostService = require('../services/ChannelPostService');
const ChatCleanupService = require('../services/ChatCleanupService');
const stateManager = require('../services/StateManager');
const { t } = require('../i18n');

class HistoryHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  get bot() {
    return this.bs.bot;
  }

  _historyState(state, filter, page) {
    return {
      mode: 'history_view',
      historyFilter: filter ?? state?.historyFilter ?? 'published',
      historyPage: page ?? state?.historyPage ?? 0
    };
  }

  async handleCallback(userId, data, state) {
    const guestBlock = async () => this.bs.requireGuestAllowed(userId);
    const loc = await this.bs.locale(userId);
    let filter = state?.historyFilter || 'published';
    let page = state?.historyPage || 0;

    if (data === 'menu_history') {
      filter = 'published';
      page = 0;
    } else if (data === 'history_filter_published') {
      filter = 'published';
      page = 0;
    } else if (data === 'history_filter_scheduled') {
      filter = 'scheduled';
      page = 0;
    } else if (data === 'history_filter_all') {
      filter = 'all';
      page = 0;
    } else if (data === 'history_filter_deleted') {
      filter = 'deleted';
      page = 0;
    } else if (data === 'history_filters') {
      filter = state?.historyFilter || 'published';
      const ui = await UiStyleService.get(userId);
      return this.bs.sendMessage(
        userId,
        `<b>${t('history.filter.menu', null, loc)}</b>`,
        {
          parse_mode: 'HTML',
          ...(await MenuService.getHistoryFilterPickerMenu(filter, ui, loc))
        }
      );
    } else if (data === 'history_sync') {
      if (!(await guestBlock())) return;
      filter = state?.historyFilter || 'published';
      page = state?.historyPage || 0;
      return this.runChannelSync(userId, filter, page);
    } else if (data === 'history_back') {
      filter = state?.historyFilter || 'published';
      page = state?.historyPage || 0;
      stateManager.set(userId, this._historyState(state, filter, page));
      return this.showHistoryList(userId, filter, page);
    } else if (data.startsWith('history_page_')) {
      page = parseInt(data.replace('history_page_', ''), 10) || 0;
      filter = state?.historyFilter || 'published';
    }

    const editStartMatch = data.match(/^history_pub_edit_(\d+)$/);
    if (editStartMatch) {
      if (!(await guestBlock())) return;
      return this.startChannelEdit(userId, editStartMatch[1], state);
    }

    const deleteMatch = data.match(/^history_pub_delete_(\d+)$/);
    if (deleteMatch) {
      if (!(await guestBlock())) return;
      return this.showDeleteConfirm(userId, deleteMatch[1], state);
    }

    const deleteOkMatch = data.match(/^history_pub_delete_ok_(\d+)$/);
    if (deleteOkMatch) {
      if (!(await guestBlock())) return;
      return this.confirmDelete(userId, deleteOkMatch[1], state);
    }

    const editsMatch = data.match(/^history_pub_edits_(\d+)$/);
    if (editsMatch) {
      return this.showEditHistory(userId, editsMatch[1], state);
    }

    const textMatch = data.match(/^history_pub_text_(\d+)$/);
    if (textMatch) {
      return this.sendFullText(userId, textMatch[1], state);
    }

    const pubMatch = data.match(/^history_pub_(\d+)$/);
    if (pubMatch) {
      return this.showPublishedCard(userId, pubMatch[1], state);
    }

    const schMatch = data.match(/^history_sch_([0-9a-f-]+)$/);
    if (schMatch && !data.includes('_cancel_') && !data.includes('_now_') && !data.includes('_reschedule_')) {
      return this.showScheduledCard(userId, schMatch[1], state);
    }

    const cancelMatch = data.match(/^history_sch_cancel_([0-9a-f-]+)$/);
    if (cancelMatch) {
      if (!(await guestBlock())) return;
      await this.bs.postRepository.removeScheduled(cancelMatch[1]);
      await this.bs.sendMessage(userId, t('history.scheduled.cancelled', null, loc) + ' ✅');
      filter = state?.historyFilter || 'scheduled';
      page = 0;
      stateManager.set(userId, this._historyState(state, filter, page));
      return this.showHistoryList(userId, filter, page);
    }

    const nowMatch = data.match(/^history_sch_now_([0-9a-f-]+)$/);
    if (nowMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.bs.postRepository.getById(nowMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.bs.sendMessage(userId, t('history.scheduled.not_found', null, loc), await MenuService.getMainMenu());
      }
      const publish = await this.bs.tryPublish(userId, scheduled.chatId, scheduled.messageId, {
        releaseStagingId: scheduled.messageId
      });
      if (!publish.ok) {
        await this.bs.postRepository.markAsFailed(scheduled.id, publish.message);
        if (publish.sourceMissing) {
          await ChatCleanupService.releasePinnedMessage(this.bot, userId, scheduled.messageId);
        }
        await this.bs.sendMessage(userId, publish.message, await MenuService.getMainMenu());
        return;
      }
      await this.bs.postRepository.markAsPublished(scheduled.id);
      await this.bs.sendPublishConfirmation(userId, publish.result);
      filter = state?.historyFilter || 'scheduled';
      stateManager.set(userId, this._historyState(state, filter, 0));
      return this.showHistoryList(userId, filter, 0);
    }

    const rescheduleMatch = data.match(/^history_sch_reschedule_([0-9a-f-]+)$/);
    if (rescheduleMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.bs.postRepository.getById(rescheduleMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.bs.sendMessage(userId, t('history.scheduled.not_found', null, loc), await MenuService.getMainMenu());
      }
      const today = new Date();
      stateManager.set(userId, {
        mode: 'waiting_date',
        scheduledId: scheduled.id,
        chatId: scheduled.chatId,
        messageId: scheduled.messageId,
        previewText: scheduled.preview || '',
        media: scheduled.media || null,
        historyFilter: state?.historyFilter || 'scheduled',
        historyPage: state?.historyPage || 0
      });
      return this.bs.sendMessage(
        userId,
        t('history.scheduled.pick_date', null, loc),
        MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get(userId))
      );
    }

    stateManager.set(userId, this._historyState(state, filter, page));
    return this.showHistoryList(userId, filter, page);
  }

  async handleMessageStep(userId, msg, state) {
    if (state?.mode !== 'waiting_channel_edit_text') return false;

    const loc = await this.bs.locale(userId);
    const text = msg.text?.trim();
    if (!text) {
      await this.bs.sendMessage(userId, t('history.edit.empty', null, loc));
      return true;
    }

    await ChatCleanupService.consumeUserMessage(this.bot, msg);
    const postId = state.channelMessageId;
    const filter = state.historyFilter || 'published';
    const page = state.historyPage || 0;

    try {
      await this.bs.channelPostService.editText(postId, text, { source: 'bot' });
      await this.bs.sendMessage(userId, t('history.edit.saved', null, loc) + ' ✅');
    } catch (err) {
      await this.bs.sendMessage(userId, ChannelPostService.formatEditError(err));
    }

    stateManager.set(userId, this._historyState(state, filter, page));
    return this.showPublishedCard(userId, postId, { historyFilter: filter, historyPage: page });
  }

  async startChannelEdit(userId, postId, state) {
    const loc = await this.bs.locale(userId);
    const item = await HistoryService.getItem({ kind: 'published', refId: postId });
    if (!item) {
      return this.bs.sendMessage(userId, t('history.post.not_found', null, loc), await MenuService.getMainMenu());
    }
    if (item.lifecycleStatus === 'deleted') {
      return this.bs.sendMessage(userId, t('history.edit.deleted', null, loc));
    }
    if (item.media && !item.preview?.trim()) {
      return this.bs.sendMessage(userId, t('history.edit.no_caption', null, loc));
    }

    stateManager.set(userId, {
      mode: 'waiting_channel_edit_text',
      channelMessageId: Number(postId),
      historyFilter: state?.historyFilter || 'published',
      historyPage: state?.historyPage || 0
    });

    const preview = item.preview?.trim()
      ? `<pre>${HistoryService._escapeHtml(HistoryService.truncatePreview(item.preview, 800, loc))}</pre>`
      : `<i>${t('history.no_text', null, loc)}</i>`;

    return this.bs.sendMessage(
      userId,
      `${t('history.edit.prompt', { id: postId }, loc)}\n\n${preview}`,
      { parse_mode: 'HTML' }
    );
  }

  async showDeleteConfirm(userId, postId, state) {
    const loc = await this.bs.locale(userId);
    const ui = await UiStyleService.get(userId);
    stateManager.set(userId, this._historyState(state, state?.historyFilter, state?.historyPage));
    return this.bs.sendMessage(
      userId,
      `<b>${t('history.delete.confirm_title', { id: postId }, loc)}</b>\n\n${t('history.delete.confirm_hint', null, loc)}`,
      {
        parse_mode: 'HTML',
        ...MenuService.getPublishedDeleteConfirmMenu(postId, ui, loc)
      }
    );
  }

  async confirmDelete(userId, postId, state) {
    const loc = await this.bs.locale(userId);
    try {
      await this.bs.channelPostService.deleteFromChannel(postId);
      await this.bs.sendMessage(userId, t('history.delete.done', { id: postId }, loc) + ' ✅');
    } catch (err) {
      await this.bs.sendMessage(userId, ChannelPostService.formatDeleteError(err));
    }
    const filter = state?.historyFilter || 'published';
    stateManager.set(userId, this._historyState(state, filter, state?.historyPage || 0));
    return this.showPublishedCard(userId, postId, state);
  }

  async showEditHistory(userId, postId, state) {
    const loc = await this.bs.locale(userId);
    const item = await HistoryService.getItem({ kind: 'published', refId: postId });
    if (!item) {
      return this.bs.sendMessage(userId, t('history.post.not_found', null, loc), await MenuService.getMainMenu());
    }
    const ui = await UiStyleService.get(userId);
    stateManager.set(userId, this._historyState(state, state?.historyFilter, state?.historyPage));
    return this.bs.sendMessage(
      userId,
      await HistoryService.formatEditHistoryCard(item, {}, loc, userId),
      {
        parse_mode: 'HTML',
        ...MenuService.getEditHistoryMenu(postId, ui, loc)
      }
    );
  }

  async sendFullText(userId, postId, state) {
    const loc = await this.bs.locale(userId);
    const item = await HistoryService.getItem({ kind: 'published', refId: postId });
    if (!item?.preview?.trim()) {
      return this.bs.sendMessage(userId, t('history.no_text', null, loc));
    }
    stateManager.set(userId, this._historyState(state, state?.historyFilter, state?.historyPage));
    return this.bs.sendMessage(userId, item.preview, {}, { noNav: true });
  }

  async runChannelSync(userId, filter, page, { silent = false } = {}) {
    const loc = await this.bs.locale(userId);
    if (!ChannelSyncService.canSync()) {
      const hint =
        loc === 'en'
          ? 'Sync unavailable: set <code>TG_API_ID</code>, <code>TG_API_HASH</code>, <code>TG_SESSION</code>.\n\n1. <code>npm run gram:login</code>\n2. Restart the bot\n\nOn server add these to Runtime Variables.'
          : 'Синхронизация недоступна: нужны <code>TG_API_ID</code>, <code>TG_API_HASH</code>, <code>TG_SESSION</code>.\n\n' +
            '1. <code>npm run gram:login</code>\n2. Перезапустите бота\n\nНа сервере добавьте их в Runtime Variables.';
      return this.bs.sendMessage(userId, hint, { parse_mode: 'HTML' });
    }

    let preamble = null;
    if (!silent) {
      await this.bs.sendMessage(userId, t('history.sync.running', null, loc), {}, { noNav: true });
    }

    try {
      const result = await ChannelSyncService.syncChannel();
      if (!silent) {
        preamble = ChannelSyncService.formatSyncReport(result, loc);
      }
    } catch (err) {
      console.error('[HistoryHandlers] channel sync error:', err.message);
      if (!silent) {
        preamble = `❌ ${err.message}`;
      }
    }

    stateManager.set(userId, { mode: 'history_view', historyFilter: filter, historyPage: page });
    return this.showHistoryList(userId, filter, page, { tryAutoSync: false, preamble });
  }

  async showHistoryList(userId, filter, page, { tryAutoSync = true, preamble = null } = {}) {
    const ui = await UiStyleService.get(userId);
    let result = await HistoryService.list({ filter, page, userId });

    if (tryAutoSync && result.total === 0 && filter === 'published' && ChannelSyncService.canSync()) {
      await this.runChannelSync(userId, filter, page, { silent: true });
      return this.showHistoryList(userId, filter, page, { tryAutoSync: false });
    }

    let header = HistoryService.formatListHeader(result);
    if (preamble) {
      header = `${preamble}\n\n${header}`;
    }

    await this.bs.sendMessage(userId, header, {
      parse_mode: 'HTML',
      ...(await MenuService.getHistoryFilters(filter, ui))
    });

    if (result.total === 0) {
      const loc = await this.bs.locale(userId);
      return this.bs.sendMessage(
        userId,
        t('history.list.pick_action', null, loc),
        await MenuService.getMainMenu(),
        { append: true }
      );
    }

    return this.bs.sendMessage(
      userId,
      t('history.list.pick_post', null, result.locale),
      MenuService.getHistoryListMenu(result.items, result.page, result.pages, ui),
      { append: true }
    );
  }

  async showPublishedCard(userId, refId, state) {
    const loc = await this.bs.locale(userId);
    const item = await HistoryService.getItem({ kind: 'published', refId });
    if (!item) {
      return this.bs.sendMessage(userId, t('history.post.not_found', null, loc), await MenuService.getMainMenu());
    }
    const ui = await UiStyleService.get(userId);
    stateManager.set(userId, this._historyState(state, state?.historyFilter, state?.historyPage));
    return this.bs.sendMessage(userId, await HistoryService.formatPublishedCard(item, loc, userId), {
      parse_mode: 'HTML',
      ...MenuService.getPublishedCardMenu(item, item.replyContext, ui, loc)
    });
  }

  async showScheduledCard(userId, refId, state) {
    const loc = await this.bs.locale(userId);
    const item = await HistoryService.getItem({ kind: 'scheduled', refId });
    if (!item) {
      return this.bs.sendMessage(userId, t('history.scheduled.not_found', null, loc), await MenuService.getMainMenu());
    }
    const ui = await UiStyleService.get(userId);
    stateManager.set(userId, this._historyState(state, state?.historyFilter, state?.historyPage));
    return this.bs.sendMessage(userId, await HistoryService.formatScheduledCard(item, userId), {
      parse_mode: 'HTML',
      ...MenuService.getScheduledCardMenu(item.refId, ui)
    });
  }
}

module.exports = HistoryHandlers;
