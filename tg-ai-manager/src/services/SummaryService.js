const ExistingPosts = require('./ExistingPosts');
const ProcessedPosts = require('./ProcessedPosts');
const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const { computeContentHash } = require('../utils/contentHash');

class SummaryService {
  static async _resolveActiveAi() {
    const autoEnrich = await SettingsService.getAutoEnrich();
    if (!autoEnrich) return null;

    let providerId = await SettingsService.getActiveProvider();
    const secrets = providerId ? await SecretsService.getProviderSecret(providerId) : null;

    if (!providerId || !AiProviderRegistry.isConfigured(providerId, secrets)) {
      const configured = [];
      for (const p of AiProviderRegistry.listAll()) {
        const s = await SecretsService.getProviderSecret(p.id);
        if (AiProviderRegistry.isConfigured(p.id, s)) configured.push(p.id);
      }
      if (configured.length === 0) return null;
      providerId = configured[0];
      await SettingsService.setActiveProvider(providerId);
    }

    const finalSecrets = await SecretsService.getProviderSecret(providerId);
    const model = await SettingsService.getModel(providerId);
    return { providerId, secrets: finalSecrets, model };
  }

  static async canEnrich() {
    return Boolean(await this._resolveActiveAi());
  }

  static async enrichPost(messageId, postText, options = {}) {
    const { force = false, quiet = false } = options;
    if (!postText?.trim()) return false;

    const id = Number(messageId);
    const contentHash = computeContentHash(postText);
    const existing = await ExistingPosts.getById(id);

    if (
      !force &&
      existing?.title?.trim() &&
      existing.contentHash === contentHash
    ) {
      await ProcessedPosts.markProcessed(id, contentHash);
      return false;
    }

    if (!force && (await ProcessedPosts.isProcessed(id, contentHash))) {
      return false;
    }

    const ctx = await this._resolveActiveAi();
    if (!ctx) {
      if (!quiet) {
        console.log('[SummaryService] AI not configured or auto-enrich off, skipping');
      }
      return false;
    }

    try {
      const ai = await AiProviderRegistry.summarize(ctx.providerId, postText, {
        model: ctx.model,
        secrets: ctx.secrets
      });

      await ExistingPosts.updatePost(id, {
        title: ai.title,
        mainIdea: ai.mainIdea,
        tags: ai.tags,
        category: ai.category,
        keywords: ai.keywords,
        aiVersion: 1,
        contentHash
      });
      await ProcessedPosts.markProcessed(id, contentHash);
      console.log(`[SummaryService] Post #${id} enriched via ${ctx.providerId}`);
      return true;
    } catch (err) {
      console.error('[SummaryService] enrichPost error:', err.message);
      return false;
    }
  }

  static async enrichAll({ missingOnly = true, limit = 50 } = {}) {
    const ctx = await this._resolveActiveAi();
    if (!ctx) {
      console.log('[SummaryService] AI not configured or auto-enrich off');
      return { enriched: 0, skipped: 0 };
    }

    const posts = await ExistingPosts.getAll();
    let enriched = 0;
    let skipped = 0;
    let processed = 0;

    for (const post of posts) {
      if (post.lifecycleStatus === 'deleted') continue;
      if (!post.post?.trim()) continue;
      if (processed >= limit) break;

      const hash = computeContentHash(post.post);
      if (missingOnly && (await ProcessedPosts.isProcessed(post.id, hash))) {
        skipped++;
        continue;
      }

      const ok = await this.enrichPost(post.id, post.post, { force: !missingOnly });
      if (ok) enriched++;
      else skipped++;
      processed++;
    }

    return { enriched, skipped };
  }
}

module.exports = SummaryService;
