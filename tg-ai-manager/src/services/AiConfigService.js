const SettingsService = require('./SettingsService');
const SecretsService = require('./SecretsService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const StorageRegistry = require('../storage/StorageRegistry');
const { isCollectionEmpty } = require('../storage/syncUtils');
const { t } = require('../i18n');

class AiConfigService {
  static async listConfiguredProviderIds() {
    const ids = [];
    for (const p of AiProviderRegistry.listAll()) {
      const secrets = await SecretsService.getProviderSecret(p.id);
      if (AiProviderRegistry.isConfigured(p.id, secrets)) ids.push(p.id);
    }
    return ids;
  }

  static async resolveForGeneration() {
    let providerId = await SettingsService.getActiveProvider();
    let secrets = providerId ? await SecretsService.getProviderSecret(providerId) : null;

    if (!providerId || !AiProviderRegistry.isConfigured(providerId, secrets)) {
      const configured = await this.listConfiguredProviderIds();
      if (configured.length === 0) return null;
      providerId = configured[0];
      await SettingsService.setActiveProvider(providerId);
      secrets = await SecretsService.getProviderSecret(providerId);
    }

    if (!providerId || !AiProviderRegistry.isConfigured(providerId, secrets)) return null;

    const model = await SettingsService.getModel(providerId);
    return { providerId, secrets, model };
  }

  static async isReady() {
    return Boolean(await this.resolveForGeneration());
  }

  static async diagnose() {
    const active = await SettingsService.getActiveProvider();
    const configured = await this.listConfiguredProviderIds();
    const backend = StorageRegistry.getBackend()?.name || 'file';
    const issues = [];

    if (!active && configured.length === 0) {
      issues.push({ code: 'no_providers' });
    } else if (active && !configured.includes(active)) {
      issues.push({ code: 'active_missing_secret', providerId: active });
    } else if (!active && configured.length > 0) {
      issues.push({ code: 'active_not_set', configured });
    }

    if (backend === 'dual') {
      try {
        const file = StorageRegistry.getFileBackend();
        const localSecrets = await file.read('secrets', { providers: {} });
        const localSettings = await file.read('settings', {});
        const localEmpty =
          isCollectionEmpty('secrets', localSecrets) && isCollectionEmpty('settings', localSettings);

        if (localEmpty && configured.length === 0) {
          const dual = StorageRegistry.getBackend();
          if (dual.name === 'dual') {
            const remoteSecrets = await dual.cloud.read('secrets', { providers: {} });
            const remoteSettings = await dual.cloud.read('settings', {});
            const cloudHasAi =
              !isCollectionEmpty('secrets', remoteSecrets) || !isCollectionEmpty('settings', remoteSettings);
            if (cloudHasAi) {
              issues.push({ code: 'dual_local_empty_cloud_has_ai' });
            }
          }
        }
      } catch {
        /* optional */
      }
    }

    return { active, configured, backend, issues };
  }

  static async formatNotReadyMessage(locale = null) {
    const loc = locale || (await SettingsService.getLocale());
    const diag = await this.diagnose();

    if (diag.issues.some((i) => i.code === 'dual_local_empty_cloud_has_ai')) {
      return t('ai.error.dual_pull', null, loc);
    }
    if (diag.issues.some((i) => i.code === 'active_missing_secret')) {
      const name = AiProviderRegistry.getLabel(diag.active);
      return t('ai.error.active_missing_secret', { name }, loc);
    }
    if (diag.issues.some((i) => i.code === 'active_not_set')) {
      return t('ai.error.active_not_set', null, loc);
    }
    return t('topics.no_ai', null, loc);
  }
}

module.exports = AiConfigService;
