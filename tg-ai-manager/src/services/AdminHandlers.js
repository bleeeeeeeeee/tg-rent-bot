const AccessService = require('./AccessService');
const AdminPanelService = require('./AdminPanelService');
const AdminUIService = require('./AdminUIService');
const SyncService = require('./SyncService');
const SettingsService = require('./SettingsService');
const UserSettingsService = require('./UserSettingsService');
const SecretsService = require('./SecretsService');
const StorageRegistry = require('../storage/StorageRegistry');
const ChannelSyncService = require('./ChannelSyncService');
const AiProviderRegistry = require('../ai/AiProviderRegistry');
const MenuService = require('./MenuService');
const UiStyleService = require('./UiStyleService');
const RateLimitService = require('./RateLimitService');
const AuditService = require('./AuditService');
const stateManager = require('./StateManager');
const ChatCleanupService = require('./ChatCleanupService');
const { t } = require('../i18n');
const { STORAGE_BACKEND } = require('../config');

class AdminHandlers {
  constructor(botService) {
    this.bs = botService;
  }

  async locale(userId) {
    return UserSettingsService.getLocale(userId);
  }

  async requireSession(userId) {
    if (!AdminPanelService.isActive(userId)) {
      const loc = await this.locale(userId);
      await this.bs.sendMessage(userId, t('admin.session.expired', null, loc));
      return false;
    }
    AdminPanelService.touch(userId);
    return true;
  }

  async promptEntry(userId) {
    const loc = await this.locale(userId);
    if (!(await this.bs.requireOwner(userId, t('admin.unavailable', null, loc)))) return;

    if (!(await AdminPanelService.isMasterPasswordSet())) {
      stateManager.set(userId, { mode: 'waiting_admin_password', adminSetup: true });
      return this.bs.sendMessage(userId, t('admin.prompt.set_password', null, loc), { noNav: true });
    }

    if (AdminPanelService.isActive(userId)) {
      return this.showHub(userId);
    }

    stateManager.set(userId, { mode: 'waiting_admin_password' });
    return this.bs.sendMessage(userId, t('admin.prompt.password', null, loc), { noNav: true });
  }

  async showHub(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    const ui = await UiStyleService.get(userId);
    const text = await AdminUIService.formatHub();
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminHubMenu(ui, loc))
    }, sendOpts);
  }

  async showAccess(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    const text = await AdminUIService.formatAccessScreen();
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminAccessMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showCloud(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    const cloud = await SettingsService.getCloud();
    const mode = cloud.mode || STORAGE_BACKEND || 'file';
    const text = await AdminUIService.formatCloudScreen();
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminCloudMenu(mode, await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showCloudStorage(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    const cloud = await SettingsService.getCloud();
    const mode = cloud.mode || STORAGE_BACKEND || 'file';
    return this.bs.sendMessage(userId, `<b>${t('admin.cloud.menu.storage', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminCloudStorageMenu(mode, await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showCloudSync(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('admin.cloud.menu.sync', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminCloudSyncMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showCloudCredentials(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('admin.cloud.menu.credentials', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminCloudCredentialsMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showCloudBackup(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('admin.cloud.menu.backup', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminCloudBackupMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showAccessInvites(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('admin.access.menu.invites', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminAccessInvitesMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async showSystem(userId) {
    const loc = await this.locale(userId);
    const text = await AdminUIService.formatSystemScreen();
    const UiStyleService = require('./UiStyleService');
    const style = await UiStyleService.get(userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: UiStyleService.backLabel(style, t('admin.back.hub', null, loc)), callback_data: 'admin_hub' }],
          [{ text: UiStyleService.backLabel(style), callback_data: 'cancel' }]
        ]
      }
    });
  }

  async showMaintenance(userId, sendOpts = {}) {
    const loc = await this.locale(userId);
    return this.bs.sendMessage(userId, `<b>${t('admin.maintenance.title', null, loc)}</b>`, {
      parse_mode: 'HTML',
      ...(await MenuService.getAdminMaintenanceMenu(await UiStyleService.get(userId), loc))
    }, sendOpts);
  }

  async handleCallback(userId, data) {
    if (!(await this.requireSession(userId))) return;

    const loc = await this.locale(userId);

    if (data === 'admin_hub') {
      return this.showHub(userId);
    }

    if (data === 'admin_access') {
      return this.showAccess(userId);
    }

    if (data === 'admin_access_invites') {
      return this.showAccessInvites(userId);
    }

    if (data === 'admin_cloud') {
      return this.showCloud(userId);
    }

    if (data === 'admin_cloud_storage') {
      return this.showCloudStorage(userId);
    }

    if (data === 'admin_cloud_sync') {
      return this.showCloudSync(userId);
    }

    if (data === 'admin_cloud_credentials') {
      return this.showCloudCredentials(userId);
    }

    if (data === 'admin_cloud_backup') {
      return this.showCloudBackup(userId);
    }

    if (data === 'admin_system') {
      return this.showSystem(userId);
    }

    if (data === 'admin_maintenance') {
      return this.showMaintenance(userId);
    }

    if (data === 'admin_logout') {
      AdminPanelService.revoke(userId);
      await AuditService.log('admin_logout', { userId });
      return this.bs.sendMessage(userId, t('admin.logged_out', null, loc));
    }

    if (data === 'admin_access_set_password') {
      stateManager.set(userId, { mode: 'waiting_master_password', adminReturn: 'access' });
      return this.bs.sendMessage(userId, t('admin.prompt.set_password', null, loc));
    }

    if (data === 'admin_access_invite_24' || data === 'admin_access_invite_168') {
      const hours = data.endsWith('_168') ? 168 : 24;
      const { code } = await AccessService.createInvite({
        role: 'guest',
        ttlHours: hours,
        maxUses: 1,
        createdBy: userId
      });
      return this.bs.sendMessage(
        userId,
        t('admin.access.invite_created', { hours, code }, loc),
        { parse_mode: 'HTML', ...(await MenuService.getAdminAccessMenu(await UiStyleService.get(userId), loc)) }
      );
    }

    if (data === 'admin_access_invite_custom') {
      stateManager.set(userId, { mode: 'waiting_invite_custom', adminReturn: 'access' });
      return this.bs.sendMessage(userId, t('admin.access.invite_prompt', null, loc));
    }

    if (data === 'admin_access_audit') {
      return this.showAudit(userId);
    }

    if (data === 'admin_access_guest_drafts_toggle') {
      const perms = await SettingsService.getGuestPermissions();
      await SettingsService.setGuestPermissions({ draftsEdit: !perms.draftsEdit });
      await AuditService.log('guest_perms', {
        userId,
        detail: `draftsEdit=${!perms.draftsEdit}`
      });
      return this.showAccess(userId);
    }

    if (data === 'admin_access_sessions') {
      const sessions = await AccessService.listActiveSessions();
      if (!sessions.length) {
        return this.bs.sendMessage(userId, t('admin.access.no_sessions', null, loc), await MenuService.getAdminAccessMenu(await UiStyleService.get(userId), loc));
      }
      return this.bs.sendMessage(
        userId,
        t('admin.access.revoke_hint', null, loc),
        await MenuService.getAdminSessionsMenu(sessions, await UiStyleService.get(userId), loc)
      );
    }

    const revokeMatch = data.match(/^admin_access_revoke_(.+)$/);
    if (revokeMatch) {
      await AccessService.revokeSession(revokeMatch[1]);
      await this.bs.sendMessage(userId, t('admin.access.revoked', null, loc) + ' ✅');
      return this.showAccess(userId);
    }

    if (data === 'admin_cloud_mode_dual_confirm') {
      return this.applyCloudMode(userId, 'dual', loc, { confirmed: true });
    }

    if (data === 'admin_cloud_mode_file' || data === 'admin_cloud_mode_supabase' || data === 'admin_cloud_mode_dual') {
      const mode = data.replace('admin_cloud_mode_', '');
      return this.applyCloudMode(userId, mode, loc);
    }

    if (data === 'admin_cloud_compare') {
      const comparison = await SyncService.compareLocalAndCloud();
      return this.bs.sendMessage(userId, SyncService.formatCompareReport(comparison, loc), {
        parse_mode: 'HTML',
        ...(await MenuService.getAdminCloudSyncMenu(await UiStyleService.get(userId), loc))
      });
    }

    if (data === 'admin_cloud_test') {
      await this.bs.sendMessage(userId, t('admin.cloud.testing', null, loc), {}, { noNav: true });
      const result = await SyncService.testConnection();
      const text = result.ok
        ? t('admin.cloud.test_ok', null, loc)
        : t('admin.cloud.test_fail', { error: result.error || 'failed' }, loc);
      await this.bs.sendMessage(userId, (result.ok ? '✅ ' : '❌ ') + text, { append: true });
      return this.showCloud(userId, { append: true });
    }

    if (data === 'admin_cloud_migrate') {
      await this.bs.sendMessage(userId, t('admin.cloud.migrating', null, loc), {}, { noNav: true });
      try {
        const result = await SyncService.migrateToCloud();
        await this.bs.sendMessage(userId, AdminUIService.formatMigrationReport(result, loc), { parse_mode: 'HTML', append: true });
      } catch (err) {
        await this.bs.sendMessage(userId, `❌ ${err.message}`, { append: true });
      }
      return this.showCloud(userId, { append: true });
    }

    if (data === 'admin_cloud_push') {
      const conflict = await SyncService.getPushConflictWarning();
      if (conflict) {
        const ui = await UiStyleService.get(userId);
        return this.bs.sendMessage(
          userId,
          t('admin.cloud.conflict', { time: conflict.time }, loc),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: t('admin.cloud.push_confirm', null, loc), callback_data: 'admin_cloud_push_confirm' }],
                [{ text: UiStyleService.backLabel(ui, t('admin.back.hub', null, loc)), callback_data: 'admin_cloud' }]
              ]
            }
          }
        );
      }
      return this.runCloudPush(userId, loc);
    }

    if (data === 'admin_cloud_push_confirm') {
      return this.runCloudPush(userId, loc);
    }

    if (data === 'admin_cloud_push_confirm_safe') {
      return this.runCloudPush(userId, loc, { forceEraseSafe: true });
    }

    if (data === 'admin_cloud_pull') {
      await this.bs.sendMessage(userId, t('admin.cloud.syncing', null, loc), {}, { noNav: true });
      try {
        const result = await SyncService.syncNow('pull');
        await AiProviderRegistry.refreshCustom();
        await AuditService.log('sync_pull', { userId, detail: JSON.stringify(result.counts || {}) });
        await this.bs.sendMessage(userId, AdminUIService.formatSyncReport(result, loc), { append: true });
      } catch (err) {
        await this.bs.sendMessage(userId, `❌ ${err.message}`, { append: true });
      }
      return this.showCloud(userId, { append: true });
    }

    if (data === 'admin_cloud_export') {
      try {
        await SyncService.saveBackupToFile(userId, this.bs.bot);
      } catch (err) {
        await this.bs.sendMessage(userId, `❌ ${err.message}`);
      }
      return this.showCloud(userId);
    }

    if (data === 'admin_cloud_url') {
      stateManager.set(userId, { mode: 'waiting_cloud_url', adminReturn: true });
      return this.bs.sendMessage(userId, t('admin.cloud.url_prompt', null, loc));
    }

    if (data === 'admin_cloud_key') {
      stateManager.set(userId, { mode: 'waiting_cloud_key', adminReturn: true });
      return this.bs.sendMessage(userId, t('admin.cloud.key_prompt', null, loc), { parse_mode: 'HTML' });
    }

    if (data === 'admin_maintenance_reconcile') {
      if (!ChannelSyncService.canSync()) {
        return this.bs.sendMessage(userId, t('admin.maintenance.reconcile_unavailable', null, loc), { parse_mode: 'HTML' });
      }
      await this.bs.sendMessage(userId, t('admin.maintenance.reconcile_running', null, loc), {}, { noNav: true });
      try {
        const result = await ChannelSyncService.syncChannel();
        await this.bs.sendMessage(userId, ChannelSyncService.formatSyncReport(result, loc), { append: true });
      } catch (err) {
        await this.bs.sendMessage(userId, `❌ ${err.message}`, { append: true });
      }
      return this.showMaintenance(userId, { append: true });
    }

    return this.showHub(userId);
  }

  async applyCloudMode(userId, mode, loc, { confirmed = false } = {}) {
    if (mode === 'dual' && !confirmed) {
      const comparison = await SyncService.compareLocalAndCloud();
      const risky =
        comparison.ok &&
        comparison.rows.some(
          (r) => (r.key === 'settings' || r.key === 'secrets') && r.localEmpty && !r.cloudEmpty
        );
      if (risky) {
        const ui = await UiStyleService.get(userId);
        return this.bs.sendMessage(
          userId,
          `${SyncService.formatCompareReport(comparison, loc)}\n\n${t('admin.cloud.mode_dual_warn', null, loc)}`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{
                  text: t('admin.cloud.mode_dual_confirm', null, loc),
                  callback_data: 'admin_cloud_mode_dual_confirm'
                }],
                [{ text: UiStyleService.backLabel(ui, t('admin.back.hub', null, loc)), callback_data: 'admin_cloud' }]
              ]
            }
          }
        );
      }
    }

    const { hydration } = await SyncService.applyStorageMode(mode);
    await AiProviderRegistry.refreshCustom();
    let note = t('admin.cloud.mode_set', { mode }, loc);
    if (hydration?.hydrated?.length) {
      note += `\n${t('admin.cloud.hydrated', { keys: hydration.hydrated.join(', ') }, loc)}`;
    }
    await this.bs.sendMessage(userId, note, { parse_mode: 'HTML' });
    return this.showCloudStorage(userId, { append: true });
  }

  async runCloudPush(userId, loc, { forceEraseSafe = false } = {}) {
    await this.bs.sendMessage(userId, t('admin.cloud.syncing', null, loc), {}, { noNav: true });
    try {
      const result = await SyncService.syncNow('push', { force: forceEraseSafe });
      if (result.needsConfirm) {
        const ui = await UiStyleService.get(userId);
        const keys = result.blocked.map((b) => b.key).join(', ');
        await this.bs.sendMessage(
          userId,
          t('admin.cloud.push_erase_warn', { keys }, loc),
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{
                  text: t('admin.cloud.push_confirm_safe', null, loc),
                  callback_data: 'admin_cloud_push_confirm_safe'
                }],
                [{ text: UiStyleService.backLabel(ui), callback_data: 'admin_cloud' }]
              ]
            }
          },
          { append: true }
        );
        return this.showCloud(userId, { append: true });
      }
      await AuditService.log('sync_push', { userId, detail: JSON.stringify(result.counts || {}) });
      await this.bs.sendMessage(userId, AdminUIService.formatSyncReport(result, loc), { append: true });
    } catch (err) {
      await this.bs.sendMessage(userId, `❌ ${err.message}`, { append: true });
    }
    return this.showCloud(userId, { append: true });
  }

  async showAudit(userId) {
    const loc = await this.locale(userId);
    const entries = await AuditService.listRecent(20);
    const text = await AdminUIService.formatAuditScreen(entries, loc);
    const ui = await UiStyleService.get(userId);
    return this.bs.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: UiStyleService.backLabel(ui, t('admin.back.hub', null, loc)), callback_data: 'admin_access' }],
          [{ text: UiStyleService.backLabel(ui), callback_data: 'cancel' }]
        ]
      }
    });
  }

  async handleInviteCustom(userId, msg, state) {
    const loc = await this.locale(userId);
    const parts = msg.text?.trim().split(/\s+/);
    if (!parts || parts.length < 2) {
      return this.bs.sendMessage(userId, t('admin.access.invite_prompt', null, loc));
    }
    const hours = parseInt(parts[0], 10);
    const maxUses = parseInt(parts[1], 10);
    if (!hours || hours < 1 || hours > 8760 || !maxUses || maxUses < 1 || maxUses > 100) {
      return this.bs.sendMessage(userId, t('admin.access.invite_prompt', null, loc));
    }
    await ChatCleanupService.deleteUserMessage(this.bs.bot, msg.chat.id, msg.message_id);
    const { code } = await AccessService.createInvite({
      role: 'guest',
      ttlHours: hours,
      maxUses,
      createdBy: userId
    });
    await this.bs.clearState(userId);
    return this.bs.sendMessage(
      userId,
      t('admin.access.invite_created', { hours, code }, loc),
      { parse_mode: 'HTML', ...(await MenuService.getAdminAccessMenu(await UiStyleService.get(userId), loc)) }
    );
  }

  async handleMessageStep(userId, msg, state) {
    if (state.mode === 'waiting_master_password') {
      const loc = await this.locale(userId);
      const value = msg.text?.trim();
      if (!value || value.length < 6) {
        return this.bs.sendMessage(userId, t('admin.prompt.set_password', null, loc));
      }
      await ChatCleanupService.deleteUserMessage(this.bs.bot, msg.chat.id, msg.message_id);
      await AccessService.setMasterPassword(value);
      const adminReturn = state.adminReturn;
      await this.bs.clearState(userId);
      AdminPanelService.grant(userId);
      await this.bs.sendMessage(userId, '✅ ' + t('admin.access.password_saved', null, loc));
      if (adminReturn === 'access') return this.showAccess(userId);
      return this.showHub(userId);
    }

    if (state.mode === 'waiting_cloud_url') {
      const loc = await this.locale(userId);
      const url = msg.text?.trim();
      if (!url || !/^https:\/\/.+\.supabase\.co\/?$/i.test(url)) {
        return this.bs.sendMessage(userId, t('admin.cloud.url_prompt', null, loc));
      }
      await ChatCleanupService.consumeUserMessage(this.bs.bot, msg);
      await SecretsService.setSupabaseConfig({ url: url.replace(/\/$/, '') });
      await SettingsService.setCloud({ supabaseUrl: url.replace(/\/$/, '') });
      await this.bs.clearState(userId);
      await this.bs.sendMessage(userId, '✅ ' + t('admin.cloud.url_saved', null, loc));
      return this.showCloud(userId);
    }

    if (state.mode === 'waiting_cloud_key') {
      const loc = await this.locale(userId);
      const key = msg.text?.trim();
      if (!key || key.length < 20) {
        return this.bs.sendMessage(userId, t('admin.cloud.key_prompt', null, loc));
      }
      await ChatCleanupService.deleteUserMessage(this.bs.bot, msg.chat.id, msg.message_id);
      await SecretsService.setSupabaseConfig({ serviceKey: key });
      StorageRegistry.reset();
      await this.bs.clearState(userId);
      await this.bs.sendMessage(userId, '✅ ' + t('admin.cloud.key_saved', null, loc));
      return this.showCloud(userId);
    }

    return false;
  }

  async handleAdminPassword(userId, msg, state) {
    const loc = await this.locale(userId);
    const password = msg.text?.trim();

    if (RateLimitService.isBlocked(userId, 'admin_auth')) {
      return this.bs.sendMessage(userId, t('auth.rate_limited', null, loc), { noNav: true });
    }

    if (!password || password.length < 6) {
      return this.bs.sendMessage(userId, t('admin.prompt.set_password', null, loc), { noNav: true });
    }

    await ChatCleanupService.deleteUserMessage(this.bs.bot, msg.chat.id, msg.message_id);

    if (state.adminSetup || !(await AdminPanelService.isMasterPasswordSet())) {
      await AccessService.setMasterPassword(password);
      AdminPanelService.grant(userId);
      RateLimitService.clear(userId, 'admin_auth');
      await AuditService.log('admin_login', { userId, detail: 'setup' });
      await this.bs.clearState(userId);
      await this.bs.sendMessage(userId, t('admin.access.password_saved', null, loc) + ' ✅');
      return this.showHub(userId);
    }

    const ok = await AdminPanelService.verifyMasterPassword(password);
    if (!ok) {
      RateLimitService.recordFailure(userId, 'admin_auth');
      return this.bs.sendMessage(userId, t('admin.invalid_password', null, loc), { noNav: true });
    }

    AdminPanelService.grant(userId);
    RateLimitService.clear(userId, 'admin_auth');
    await AuditService.log('admin_login', { userId });
    await this.bs.clearState(userId);
    return this.showHub(userId);
  }
}

module.exports = AdminHandlers;
