const { t } = require('../i18n');
const SettingsService = require('./SettingsService');
const SyncService = require('./SyncService');
const AccessService = require('./AccessService');
const ExistingPosts = require('./ExistingPosts');
const PostRepository = require('./PostRepository');
const SecretsService = require('./SecretsService');
const AiConfigService = require('./AiConfigService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const { STORAGE_BACKEND, INSTANCE_ID } = require('../config');

class AdminUIService {
  static async locale() {
    return SettingsService.getLocale();
  }

  static async formatHub() {
    const loc = await this.locale();
    return (
      `<b>${t('admin.hub.title', null, loc)}</b>\n\n` +
      `${t('admin.hub.hint', null, loc)}`
    );
  }

  static async formatAccessScreen() {
    const loc = await this.locale();
    const masterSet = await AccessService.isMasterPasswordSet();
    const sessions = await AccessService.listActiveSessions();
    const guestPerms = await SettingsService.getGuestPermissions();
    const draftsState = guestPerms.draftsEdit
      ? (loc === 'en' ? 'on' : 'вкл')
      : (loc === 'en' ? 'off' : 'выкл');
    return (
      `<b>${t('admin.access.title', null, loc)}</b>\n\n` +
      `${t('admin.access.set_password', null, loc)}: <b>${masterSet ? '✓' : '—'}</b>\n` +
      `${t('admin.access.sessions', null, loc)}: <b>${sessions.length}</b>\n` +
      `${t('admin.access.guest_drafts_edit', null, loc)}: <b>${draftsState}</b>`
    );
  }

  static async formatAuditScreen(entries, locale = 'ru') {
    const loc = locale || (await this.locale());
    if (!entries?.length) {
      return `<b>${t('admin.audit.title', { n: 0 }, loc)}</b>\n\n${t('admin.audit.empty', null, loc)}`;
    }
    const lines = [`<b>${t('admin.audit.title', { n: entries.length }, loc)}</b>`, ''];
    for (const e of entries) {
      const who = e.userId ? `#${e.userId}` : '—';
      const detail = e.detail ? ` · ${e.detail}` : '';
      lines.push(`• <code>${e.at.slice(0, 19)}</code> ${e.action} ${who}${detail}`);
    }
    return lines.join('\n');
  }

  static async formatCloudScreen() {
    const loc = await this.locale();
    const cloud = await SettingsService.getCloud();
    const mode = cloud.mode || STORAGE_BACKEND || 'file';
    const secrets = await SecretsService.getSupabaseConfig();
    const url = secrets?.url || cloud.supabaseUrl || '—';
    const keyMask = secrets?.serviceKey ? SecretsService.maskSecret(secrets.serviceKey) : '—';
    const syncStatus = SyncService.getStatus();
    let metaLine = '';
    try {
      const meta = await SyncService.getCloudMeta();
      if (meta?.instance_id) {
        metaLine = `\n${t('admin.system.cloud_instance', null, loc)}: <code>${meta.instance_id}</code>`;
      }
    } catch {
      /* optional */
    }

    const aiDiag = await AiConfigService.diagnose();
    let aiLine;
    if (aiDiag.configured.length > 0) {
      const name = AiProviderRegistry.getLabel(aiDiag.active || aiDiag.configured[0]);
      aiLine = t('admin.cloud.ai_ok', { name, count: aiDiag.configured.length }, loc);
    } else if (aiDiag.issues.some((i) => i.code === 'dual_local_empty_cloud_has_ai')) {
      aiLine = t('admin.cloud.ai_pull_hint', null, loc);
    } else {
      aiLine = t('admin.cloud.ai_missing', null, loc);
    }

    return (
      `<b>${t('admin.cloud.title', null, loc)}</b>\n\n` +
      `Mode: <b>${mode}</b>\n` +
      `URL: <code>${url}</code>\n` +
      `Key: <code>${keyMask}</code>\n` +
      `${aiLine}\n` +
      `${t('admin.system.realtime', null, loc)}: <b>${syncStatus.connected ? t('admin.system.realtime.on', null, loc) : t('admin.system.realtime.off', null, loc)}</b>\n` +
      (cloud.lastSyncAt ? `${t('admin.system.last_sync', null, loc)}: ${cloud.lastSyncAt}\n` : '') +
      (cloud.lastSyncError ? `⚠️ ${cloud.lastSyncError}\n` : '') +
      metaLine
    );
  }

  static async formatSystemScreen() {
    const loc = await this.locale();
    const syncStatus = SyncService.getStatus();
    const cloud = await SettingsService.getCloud();
    const postCount = await ExistingPosts.count();
    const pendingCount = (await PostRepository.getAllPending()).length;
    let metaLine = '';
    try {
      const meta = await SyncService.getCloudMeta();
      if (meta?.instance_id && meta.instance_id !== INSTANCE_ID) {
        metaLine = `\n⚠️ Cloud instance: <code>${meta.instance_id}</code>`;
      }
    } catch {
      /* optional */
    }

    return (
      `<b>${t('admin.system.title', null, loc)}</b>\n\n` +
      `${t('admin.system.instance', null, loc)}: <code>${INSTANCE_ID}</code>\n` +
      `${t('admin.system.realtime', null, loc)}: ${syncStatus.connected ? t('admin.system.realtime.on', null, loc) : t('admin.system.realtime.off', null, loc)}\n` +
      `${t('admin.system.posts', null, loc)}: ${postCount}\n` +
      `${t('admin.system.scheduled', null, loc)}: ${pendingCount}\n` +
      (cloud.lastSyncAt ? `${t('admin.system.last_sync', null, loc)}: ${cloud.lastSyncAt}` : '') +
      metaLine
    );
  }

  static formatMigrationReport(result, locale = 'ru') {
    const lines = [`⬆️ ${t('admin.cloud.migrate', null, locale)}`, ''];
    for (const [key, count] of Object.entries(result.counts || {})) {
      lines.push(`• ${key}: ${count}`);
    }
    if (result.errors?.length) {
      lines.push('', '⚠️');
      for (const e of result.errors) lines.push(`• ${e}`);
    } else {
      lines.push('', '✅');
    }
    return lines.join('\n');
  }

  static formatSyncReport(result, locale = 'ru') {
    const lines = [`🔄 ${result.direction}`, ''];
    for (const [key, count] of Object.entries(result.counts || {})) {
      lines.push(`• ${key}: ${count}`);
    }
    if (result.note) lines.push('', result.note);
    lines.push('', result.ok ? '✅' : '⚠️');
    return lines.join('\n');
  }
}

module.exports = AdminUIService;
