const HistoryService = require('../services/HistoryService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const ChannelSyncService = require('../services/ChannelSyncService');
const stateManager = require('../services/StateManager');

class HistoryHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  get bot() {
    return this.bs.bot;
  }

  async handleCallback(userId, data, state) {
    const guestBlock = async () => this.bs.requireGuestAllowed(userId);
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
      const ui = await UiStyleService.get();
      const SettingsService = require('../services/SettingsService');
      const loc = await SettingsService.getLocale();
      return this.bs.sendMessage(
        userId,
        `<b>${require('../i18n').t('history.filter.menu', null, loc)}</b>`,
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
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: page
      });
      return this.showHistoryList(userId, filter, page);
    } else if (data.startsWith('history_page_')) {
      page = parseInt(data.replace('history_page_', ''), 10) || 0;
      filter = state?.historyFilter || 'published';
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
      await this.bs.sendMessage(userId, 'Запланированный пост отменён ✅');
      filter = state?.historyFilter || 'scheduled';
      page = 0;
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: page
      });
      return this.showHistoryList(userId, filter, page);
    }

    const nowMatch = data.match(/^history_sch_now_([0-9a-f-]+)$/);
    if (nowMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.bs.postRepository.getById(nowMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.bs.sendMessage(userId, 'Пост не найден или уже опубликован.', await MenuService.getMainMenu());
      }
      const publish = await this.bs.tryPublish(userId, scheduled.chatId, scheduled.messageId, {
        releaseStagingId: scheduled.messageId
      });
      if (!publish.ok) {
        await this.bs.postRepository.markAsFailed(scheduled.id, publish.message);
        if (publish.sourceMissing) {
          const ChatCleanupService = require('../services/ChatCleanupService');
          await ChatCleanupService.releasePinnedMessage(this.bot, userId, scheduled.messageId);
        }
        await this.bs.sendMessage(userId, publish.message, await MenuService.getMainMenu());
        return;
      }
      await this.bs.postRepository.markAsPublished(scheduled.id);
      await this.bs.sendPublishConfirmation(userId, publish.result);
      filter = state?.historyFilter || 'scheduled';
      stateManager.set(userId, {
        mode: 'history_view',
        historyFilter: filter,
        historyPage: 0
      });
      return this.showHistoryList(userId, filter, 0);
    }

    const rescheduleMatch = data.match(/^history_sch_reschedule_([0-9a-f-]+)$/);
    if (rescheduleMatch) {
      if (!(await guestBlock())) return;
      const scheduled = await this.bs.postRepository.getById(rescheduleMatch[1]);
      if (!scheduled || scheduled.status !== 'pending') {
        return this.bs.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
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
        'Выберите новую дату публикации:',
        MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get())
      );
    }

    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: filter,
      historyPage: page
    });
    return this.showHistoryList(userId, filter, page);
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
      const waitText = loc === 'en' ? '⏳ Syncing archive with channel…' : '⏳ Синхронизирую архив с каналом…';
      await this.bs.sendMessage(userId, waitText, {}, { noNav: true });
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
    const ui = await UiStyleService.get();
    let result = await HistoryService.list({ filter, page });

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
      return this.bs.sendMessage(userId, 'Выберите действие:', await MenuService.getMainMenu(), { append: true });
    }

    return this.bs.sendMessage(
      userId,
      'Выберите пост:',
      MenuService.getHistoryListMenu(result.items, result.page, result.pages, ui),
      { append: true }
    );
  }

  async showPublishedCard(userId, refId, state) {
    const item = await HistoryService.getItem({ kind: 'published', refId });
    if (!item) {
      return this.bs.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
    }
    const ui = await UiStyleService.get();
    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: state?.historyFilter || 'published',
      historyPage: state?.historyPage || 0
    });
    return this.bs.sendMessage(userId, await HistoryService.formatPublishedCard(item), {
      parse_mode: 'HTML',
      ...MenuService.getPublishedCardMenu(item.channelUrl, item.replyContext, ui)
    });
  }

  async showScheduledCard(userId, refId, state) {
    const item = await HistoryService.getItem({ kind: 'scheduled', refId });
    if (!item) {
      return this.bs.sendMessage(userId, 'Пост не найден.', await MenuService.getMainMenu());
    }
    const ui = await UiStyleService.get();
    stateManager.set(userId, {
      mode: 'history_view',
      historyFilter: state?.historyFilter || 'scheduled',
      historyPage: state?.historyPage || 0
    });
    return this.bs.sendMessage(userId, await HistoryService.formatScheduledCard(item), {
      parse_mode: 'HTML',
      ...MenuService.getScheduledCardMenu(item.refId, ui)
    });
  }
}

module.exports = HistoryHandlers;
