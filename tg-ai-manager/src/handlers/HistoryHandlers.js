const HistoryService = require('../services/HistoryService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const ChannelReconcileService = require('../services/ChannelReconcileService');
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
    } else if (data === 'history_sync') {
      if (!(await guestBlock())) return;
      filter = state?.historyFilter || 'published';
      page = state?.historyPage || 0;
      if (!ChannelReconcileService.canReconcile()) {
        return this.bs.sendMessage(
          userId,
          'Сверка недоступна: нужны <code>TG_API_ID</code>, <code>TG_API_HASH</code> и <code>TG_SESSION</code> в .env.\n\n' +
            '1. <code>npm run gram:login</code>\n' +
            '2. Перезапустите бота\n\n' +
            'Или на сервере: <code>npm run reconcile</code>',
          { parse_mode: 'HTML' }
        );
      }
      await this.bs.sendMessage(userId, '⏳ Сверяю архив с каналом…', {}, { noNav: true });
      try {
        const result = await ChannelReconcileService.reconcileChannel();
        let note = `✅ Сверка завершена.\nПроверено: ${result.checked}`;
        if (result.deleted) note += `\nПомечено удалёнными: ${result.deleted}`;
        else note += '\nРасхождений не найдено.';
        await this.bs.sendMessage(userId, note, { append: true });
      } catch (err) {
        console.error('[HistoryHandlers] history_sync error:', err.message);
        await this.bs.sendMessage(userId, `❌ ${err.message}`, { append: true });
      }
      stateManager.set(userId, { mode: 'history_view', historyFilter: filter, historyPage: page });
      return this.showHistoryList(userId, filter, page);
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

  async showHistoryList(userId, filter, page) {
    const ui = await UiStyleService.get();
    const result = await HistoryService.list({ filter, page });
    const header = HistoryService.formatListHeader(result);

    await this.bs.sendMessage(userId, header, {
      parse_mode: 'HTML',
      ...MenuService.getHistoryFilters(filter, ui)
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
