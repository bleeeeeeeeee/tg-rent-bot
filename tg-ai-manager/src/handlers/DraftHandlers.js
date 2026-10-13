const DraftService = require('../services/DraftService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const ChatCleanupService = require('../services/ChatCleanupService');
const stateManager = require('../services/StateManager');

class DraftHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  get bot() {
    return this.bs.bot;
  }

  async handleCallback(userId, data, state) {
    const guestMutating =
      /draft_(delete|edit|publish|wizard_delete|wizard_resume|topic_delete)/.test(data) ||
      data === 'draft_publish_now';
    if (guestMutating && !(await this.bs.requireGuestAllowed(userId, null, { allowDraftsEdit: true }))) return;

    const wizardResumeMatch = data.match(/^draft_wizard_resume_(.+)$/);
    if (wizardResumeMatch) {
      const draft = await DraftService.getById(userId, wizardResumeMatch[1]);
      if (!draft || draft.kind !== 'wizard') {
        return this.bs.sendMessage(userId, 'Черновик мастера не найден.', await MenuService.getMainMenu());
      }
      await DraftService.remove(draft.id);
      return this.bs.wizardHandlers.resumeWizardDraft(userId, draft);
    }

    const wizardDeleteMatch = data.match(/^draft_wizard_delete_(.+)$/);
    if (wizardDeleteMatch) {
      const draft = await DraftService.getById(userId, wizardDeleteMatch[1]);
      if (draft?.pinnedMessageIds?.length) {
        for (const id of draft.pinnedMessageIds) {
          await ChatCleanupService.releasePinnedMessage(this.bot, userId, id);
        }
      }
      await DraftService.remove(wizardDeleteMatch[1]);
      return this.bs.sendMessage(userId, 'Черновик мастера удалён ✅', await MenuService.getMainMenu());
    }

    const wizardSelectMatch = data.match(/^draft_wizard_(.+)$/);
    if (wizardSelectMatch) {
      const draft = await DraftService.getById(userId, wizardSelectMatch[1]);
      if (!draft || draft.kind !== 'wizard') {
        return this.bs.sendMessage(userId, 'Черновик мастера не найден.', await MenuService.getMainMenu());
      }
      return this.bs.sendMessage(
        userId,
        `✨ <b>${draft.label || 'Мастер ИИ'}</b>\n\nПродолжить с сохранённого шага?`,
        { parse_mode: 'HTML', ...MenuService.getWizardDraftActionMenu(draft.id, await UiStyleService.get(userId)) }
      );
    }

    const topicDeleteMatch = data.match(/^draft_topic_delete_(.+)$/);
    if (topicDeleteMatch) {
      await DraftService.remove(topicDeleteMatch[1]);
      await this.bs.clearState(userId);
      const loc = await this.bs.locale(userId);
      const { t } = require('../i18n');
      return this.bs.sendMessage(
        userId,
        t('topics.deleted_draft', null, loc),
        await MenuService.getMainMenu(null, { locale: loc })
      );
    }

    const topicSelectMatch = data.match(/^draft_topic_(.+)$/);
    if (topicSelectMatch) {
      const draft = await DraftService.getById(userId, topicSelectMatch[1]);
      if (!draft || draft.kind !== 'topic' || !draft.topic) {
        return this.bs.sendMessage(userId, 'Черновик темы не найден.', await MenuService.getMainMenu());
      }
      const topic = draft.topic;
      const text =
        `<b>${topic.title}</b>\n${topic.brief}` +
        (topic.angle ? `\n\n💡 ${topic.angle}` : '') +
        (topic.tags?.length ? `\n\n🏷 ${topic.tags.join(', ')}` : '');
      stateManager.set(userId, {
        mode: 'topic_review',
        topics: { items: [topic], selectedIndex: 0, draftId: draft.id }
      });
      return this.bs.sendMessage(userId, text, {
        parse_mode: 'HTML',
        ...(await MenuService.getTopicActionMenu(0, await UiStyleService.get(userId), await this.bs.locale(userId), {
          draftId: draft.id
        }))
      });
    }

    if (data === 'draft_cancel') {
      await this.bs.clearState(userId);
      return this.bs.sendMessage(
        userId,
        await this.bs.tLoc('menu.main.choose', null, userId),
        await this.bs.getMainMenuFor(userId)
      );
    }

    const selectMatch = data.match(/^draft_select_(.+)$/);
    if (selectMatch) {
      const draftId = selectMatch[1];
      const draft = await DraftService.getById(userId, draftId);
      if (!draft) {
        return this.bs.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      stateManager.set(userId, {
        mode: 'draft_action',
        draftId,
        chatId: draft.chatId,
        messageId: draft.messageId
      });
      try {
        const copied = await this.bot.copyMessage(userId, draft.chatId, draft.messageId);
        if (copied?.message_id) {
          ChatCleanupService.trackBotMessage(userId, copied.message_id);
        }
      } catch {
        /* preview optional */
      }
      return this.bs.sendMessage(
        userId,
        'Действия с черновиком:',
        MenuService.getDraftActionMenu(draftId, await UiStyleService.get(userId))
      );
    }

    const editMatch = data.match(/^draft_edit_(.+)$/);
    if (editMatch) {
      stateManager.set(userId, { mode: 'waiting_edit', draftId: editMatch[1] });
      return this.bs.sendMessage(userId, 'Отправьте новое сообщение для черновика:');
    }

    const deleteMatch = data.match(/^draft_delete_(.+)$/);
    if (deleteMatch) {
      const draft = await DraftService.getById(userId, deleteMatch[1]);
      if (draft) await this.bs.releaseDraftSource(userId, draft);
      await DraftService.remove(deleteMatch[1]);
      await this.bs.clearState(userId);
      return this.bs.sendMessage(userId, 'Черновик удалён ✅', await MenuService.getMainMenu());
    }

    const publishNowMatch = data.match(/^draft_publish_now_(.+)$/);
    if (publishNowMatch) {
      const draft = await DraftService.getById(userId, publishNowMatch[1]);
      if (!draft) {
        return this.bs.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      const stagingIds = draft.stagingMessageIds?.length
        ? draft.stagingMessageIds
        : [draft.messageId];
      const publish = await this.bs.tryPublish(userId, draft.chatId, draft.messageId, {
        messageIds: stagingIds.length ? stagingIds : undefined,
        stagedMeta: draft.stagedMeta,
        releaseStagingIds: stagingIds
      });
      if (!publish.ok) {
        await this.bs.sendMessage(userId, publish.message);
        return this.bs.sendMessage(
          userId,
          'Действия с черновиком:',
          MenuService.getDraftActionMenu(draft.id, await UiStyleService.get(userId))
        );
      }
      await DraftService.remove(draft.id);
      await this.bs.sendPublishConfirmation(userId, publish.result);
      await this.bs.clearState(userId);
      return;
    }

    const publishDelayMatch = data.match(/^draft_publish_delay_(.+)$/);
    if (publishDelayMatch) {
      const draft = await DraftService.getById(userId, publishDelayMatch[1]);
      if (!draft) {
        return this.bs.sendMessage(userId, 'Черновик не найден.', await MenuService.getMainMenu());
      }
      const today = new Date();
      stateManager.set(userId, {
        mode: 'waiting_date',
        draftId: draft.id,
        chatId: draft.chatId,
        messageId: draft.messageId,
        previewText: '',
        media: null
      });
      return this.bs.sendMessage(
        userId,
        'Выберите дату для публикации:',
        MenuService.getCalendar(today.getFullYear(), today.getMonth(), await UiStyleService.get(userId))
      );
    }
  }
}

module.exports = DraftHandlers;
