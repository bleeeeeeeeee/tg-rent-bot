const TopicIdeasService = require('../services/TopicIdeasService');
const WritingService = require('../services/WritingService');
const DraftService = require('../services/DraftService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const stateManager = require('../services/StateManager');
const HistoryService = require('../services/HistoryService');
const { t } = require('../i18n');

class TopicHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  async locale(userId) {
    return this.bs.locale(userId);
  }

  async tLoc(key, params, userId) {
    return this.bs.tLoc(key, params, userId);
  }

  async showEntry(userId) {
    const loc = await this.locale(userId);
    if (!(await WritingService.canWrite())) {
      const AiConfigService = require('../services/AiConfigService');
      return this.bs.sendMessage(
        userId,
        await AiConfigService.formatNotReadyMessage(loc),
        { parse_mode: 'HTML', ...(await MenuService.getMainMenu(null, { locale: loc })) }
      );
    }
    return this.bs.sendMessage(
      userId,
      t('topics.mode_prompt', null, loc),
      { parse_mode: 'HTML', ...(await MenuService.getTopicModeMenu(await UiStyleService.get(userId), loc)) }
    );
  }

  async showDirectionPrompt(userId, mode, referencePostIds = []) {
    const loc = await this.locale(userId);
    stateManager.set(userId, {
      mode: 'topic_choose_direction',
      topics: { mode, referencePostIds, direction: null }
    });
    return this.bs.sendMessage(
      userId,
      t('topics.direction_prompt', null, loc),
      { parse_mode: 'HTML', ...(await MenuService.getTopicDirectionMenu(await UiStyleService.get(userId), loc)) }
    );
  }

  async showCountMenu(userId, mode, referencePostIds = [], direction = null) {
    const loc = await this.locale(userId);
    const state = stateManager.get(userId) || {};
    const cfg = state.topics || {};
    stateManager.set(userId, {
      mode: 'topic_choose_count',
      topics: {
        mode,
        referencePostIds,
        direction: direction ?? cfg.direction ?? null
      }
    });
    return this.bs.sendMessage(
      userId,
      t('topics.count_prompt', null, loc),
      await MenuService.getTopicCountMenu(await UiStyleService.get(userId), loc)
    );
  }

  async showReferencePicker(userId, page = 0) {
    const loc = await this.locale(userId);
    const ui = await UiStyleService.get(userId);
    const result = await HistoryService.list({ filter: 'published', page, userId });

    if (result.total === 0) {
      return this.bs.sendMessage(
        userId,
        HistoryService.formatReferenceListHeader(result, loc),
        {
          parse_mode: 'HTML',
          ...(await MenuService.getTopicModeMenu(ui, loc))
        }
      );
    }

    stateManager.set(userId, { mode: 'topic_pick_reference', topicRefPage: result.page });

    await this.bs.sendMessage(userId, HistoryService.formatReferenceListHeader(result, loc), {
      parse_mode: 'HTML'
    });

    return this.bs.sendMessage(
      userId,
      t('topics.ref_list.pick', null, loc),
      MenuService.getTopicReferenceListMenu(result.items, result.page, result.pages, ui, loc),
      { append: true }
    );
  }

  async runGeneration(userId, count) {
    const loc = await this.locale(userId);
    const state = stateManager.get(userId) || {};
    const cfg = state.topics || { mode: 'unique', referencePostIds: [], direction: null };

    state.mode = 'topic_generating';
    stateManager.set(userId, state);
    await this.bs.sendMessage(userId, t('topics.generating', null, loc), {}, { noNav: true, transient: true });

    try {
      const result = await TopicIdeasService.generateTopics({
        mode: cfg.mode,
        count,
        referencePostIds: cfg.referencePostIds || [],
        direction: cfg.direction || null
      });

      state.mode = 'topic_review';
      state.topics = { ...cfg, count, items: result.topics };
      stateManager.set(userId, state);

      const header =
        cfg.mode === 'unique'
          ? t('topics.result_unique', { count: result.topics.length }, loc)
          : t('topics.result_similar', { count: result.topics.length }, loc);
      const directionNote = cfg.direction
        ? `\n\n<i>${t('topics.direction_applied', { direction: cfg.direction }, loc)}</i>`
        : '';

      return this.bs.sendMessage(
        userId,
        `${header}${directionNote}\n\n${TopicIdeasService.formatTopicList(result.topics, loc)}`,
        {
          parse_mode: 'HTML',
          ...(await MenuService.getTopicResultsMenu(result.topics, await UiStyleService.get(userId), loc))
        },
        { append: true }
      );
    } catch (err) {
      state.mode = 'topic_choose_count';
      stateManager.set(userId, state);
      return this.bs.sendMessage(
        userId,
        t('topics.error', { error: err.message }, loc),
        {
          parse_mode: 'HTML',
          ...(await MenuService.getTopicCountMenu(await UiStyleService.get(userId), loc))
        },
        { append: true }
      );
    }
  }

  async showTopicActions(userId, index) {
    const loc = await this.locale(userId);
    const state = stateManager.get(userId);
    const topic = state?.topics?.items?.[index];
    if (!topic) {
      return this.showEntry(userId);
    }

    state.topics.selectedIndex = index;
    stateManager.set(userId, state);

    const text =
      `<b>${topic.title}</b>\n${topic.brief}` +
      (topic.angle ? `\n\n💡 ${topic.angle}` : '') +
      (topic.tags?.length ? `\n\n🏷 ${topic.tags.join(', ')}` : '');

    const draftId = state.topics?.draftId || null;
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getTopicActionMenu(index, await UiStyleService.get(userId), loc, { draftId }))
    });
  }

  async startWizardWithTopic(userId, index) {
    const state = stateManager.get(userId);
    const topic = state?.topics?.items?.[index];
    if (!topic) return this.showEntry(userId);

    stateManager.set(userId, {
      mode: 'wizard_brief',
      wizard: {
        ...WritingService.emptyWizard(),
        title: topic.title,
        brief: topic.brief + (topic.angle ? `\n\nУгол: ${topic.angle}` : ''),
        keywords: (topic.tags || []).join(', ')
      },
      wizardStepRevisit: true
    });
    return this.bs.showWizardStep(userId, 'wizard_brief');
  }

  async saveTopicDraft(userId, index) {
    const loc = await this.locale(userId);
    const state = stateManager.get(userId);
    const topic = state?.topics?.items?.[index];
    if (!topic) return this.showEntry(userId);

    await DraftService.addTopicNote(userId, topic);
    return this.bs.sendMessage(
      userId,
      t('topics.saved_draft', { title: topic.title }, loc),
      { parse_mode: 'HTML', ...(await MenuService.getMainMenu(null, { locale: loc })) }
    );
  }

  async handleMessage(userId, msg, state) {
    if (state?.mode !== 'topic_choose_direction') return false;
    const text = msg.text?.trim();
    if (!text) return false;

    const cfg = state.topics || {};
    stateManager.set(userId, {
      ...state,
      topics: { ...cfg, direction: text.slice(0, 500) }
    });
    return this.showCountMenu(userId, cfg.mode, cfg.referencePostIds || [], text.slice(0, 500));
  }

  async handleCallback(userId, data) {
    if (data === 'publish_mode_topics') {
      return this.showEntry(userId);
    }
    if (data === 'topic_mode_unique') {
      return this.showDirectionPrompt(userId, 'unique');
    }
    if (data === 'topic_mode_similar') {
      return this.showDirectionPrompt(userId, 'similar');
    }
    if (data === 'topic_mode_similar_ref') {
      return this.showReferencePicker(userId);
    }
    if (data === 'topic_direction_skip') {
      const state = stateManager.get(userId) || {};
      const cfg = state.topics || { mode: 'unique', referencePostIds: [] };
      return this.showCountMenu(userId, cfg.mode, cfg.referencePostIds || [], null);
    }
    if (data === 'topic_back_direction') {
      const state = stateManager.get(userId) || {};
      const cfg = state.topics || { mode: 'unique', referencePostIds: [] };
      return this.showDirectionPrompt(userId, cfg.mode, cfg.referencePostIds || []);
    }

    const refPageMatch = data.match(/^topic_ref_page_(\d+)$/);
    if (refPageMatch) {
      return this.showReferencePicker(userId, Number(refPageMatch[1]));
    }

    const refMatch = data.match(/^topic_ref_(\d+)$/);
    if (refMatch) {
      const item = await HistoryService.getItem({ kind: 'published', refId: refMatch[1] });
      const refId = item ? Number(item.refId) : Number(refMatch[1]);
      return this.showDirectionPrompt(userId, 'similar', [refId]);
    }

    const countMatch = data.match(/^topic_count_(\d+)$/);
    if (countMatch) {
      return this.runGeneration(userId, Number(countMatch[1]));
    }

    if (data === 'topic_regenerate') {
      const state = stateManager.get(userId);
      const count = state?.topics?.count || 5;
      return this.runGeneration(userId, count);
    }

    const pickMatch = data.match(/^topic_pick_(\d+)$/);
    if (pickMatch) {
      return this.showTopicActions(userId, Number(pickMatch[1]));
    }

    const wizardMatch = data.match(/^topic_use_wizard_(\d+)$/);
    if (wizardMatch) {
      return this.startWizardWithTopic(userId, Number(wizardMatch[1]));
    }

    const draftMatch = data.match(/^topic_save_draft_(\d+)$/);
    if (draftMatch) {
      return this.saveTopicDraft(userId, Number(draftMatch[1]));
    }

    return null;
  }
}

module.exports = TopicHandlers;
