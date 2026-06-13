const TopicIdeasService = require('../services/TopicIdeasService');
const WritingService = require('../services/WritingService');
const ExistingPosts = require('../services/ExistingPosts');
const DraftService = require('../services/DraftService');
const MenuService = require('../services/MenuService');
const UiStyleService = require('../services/UiStyleService');
const stateManager = require('../services/StateManager');
const HistoryService = require('../services/HistoryService');
const SettingsService = require('../services/SettingsService');
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
      { parse_mode: 'HTML', ...(await MenuService.getTopicModeMenu(await UiStyleService.get(), loc)) }
    );
  }

  async showCountMenu(userId, mode, referencePostIds = []) {
    const loc = await this.locale(userId);
    stateManager.set(userId, {
      mode: 'topic_choose_count',
      topics: { mode, referencePostIds }
    });
    return this.bs.sendMessage(
      userId,
      t('topics.count_prompt', null, loc),
      await MenuService.getTopicCountMenu(await UiStyleService.get(), loc)
    );
  }

  async showReferencePicker(userId) {
    const loc = await this.locale(userId);
    const posts = (await ExistingPosts.getAll(false))
      .filter((p) => p.lifecycleStatus !== 'deleted')
      .sort((a, b) => new Date(b.added || 0) - new Date(a.added || 0))
      .slice(0, 8);

    if (!posts.length) {
      return this.bs.sendMessage(
        userId,
        t('topics.no_posts', null, loc),
        await MenuService.getTopicModeMenu(await UiStyleService.get(), loc)
      );
    }

    stateManager.set(userId, { mode: 'topic_pick_reference' });
    const tz = await SettingsService.getTimezone();
    const rows = posts.map((p) => {
      const label = HistoryService._buildButtonLabel('published', p.added, p, tz);
      return [{ text: label.slice(0, 60), callback_data: `topic_ref_${p.id}` }];
    });
    rows.push([{ text: t('topics.back_modes', null, loc), callback_data: 'publish_mode_topics' }]);

    return this.bs.sendMessage(userId, t('topics.ref_prompt', null, loc), {
      reply_markup: { inline_keyboard: rows }
    });
  }

  async runGeneration(userId, count) {
    const loc = await this.locale(userId);
    const state = stateManager.get(userId) || {};
    const cfg = state.topics || { mode: 'unique', referencePostIds: [] };

    state.mode = 'topic_generating';
    stateManager.set(userId, state);
    await this.bs.sendMessage(userId, t('topics.generating', null, loc), {}, { noNav: true });

    try {
      const result = await TopicIdeasService.generateTopics({
        mode: cfg.mode,
        count,
        referencePostIds: cfg.referencePostIds || []
      });

      state.mode = 'topic_review';
      state.topics = { ...cfg, count, items: result.topics };
      stateManager.set(userId, state);

      const header =
        cfg.mode === 'unique'
          ? t('topics.result_unique', { count: result.topics.length }, loc)
          : t('topics.result_similar', { count: result.topics.length }, loc);

      return this.bs.sendMessage(
        userId,
        `${header}\n\n${TopicIdeasService.formatTopicList(result.topics, loc)}`,
        {
          parse_mode: 'HTML',
          ...(await MenuService.getTopicResultsMenu(result.topics, await UiStyleService.get(), loc))
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
          ...(await MenuService.getTopicCountMenu(await UiStyleService.get(), loc))
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

    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getTopicActionMenu(index, await UiStyleService.get(), loc))
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

  async handleCallback(userId, data) {
    if (data === 'publish_mode_topics') {
      return this.showEntry(userId);
    }
    if (data === 'topic_mode_unique') {
      return this.showCountMenu(userId, 'unique');
    }
    if (data === 'topic_mode_similar') {
      return this.showCountMenu(userId, 'similar');
    }
    if (data === 'topic_mode_similar_ref') {
      return this.showReferencePicker(userId);
    }

    const refMatch = data.match(/^topic_ref_(\d+)$/);
    if (refMatch) {
      return this.showCountMenu(userId, 'similar', [Number(refMatch[1])]);
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
