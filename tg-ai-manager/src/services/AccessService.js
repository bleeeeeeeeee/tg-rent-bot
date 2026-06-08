const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const JsonStore = require('../storage/JsonStore');
const StorageRegistry = require('../storage/StorageRegistry');
const RateLimitService = require('./RateLimitService');
const AuditService = require('./AuditService');
const { OWNER_TELEGRAM_ID } = require('../config');

const BCRYPT_ROUNDS = 10;
const OWNER_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

class AccessService {
  static _cache = new Map();

  static async init() {
    await this.reloadCache();
  }

  static async reloadCache() {
    this._cache.clear();
    const sessions = await this._listSessionsRaw();
    const now = Date.now();
    for (const s of sessions) {
      if (s.revokedAt) continue;
      if (s.expiresAt && new Date(s.expiresAt).getTime() <= now) continue;
      this._cache.set(String(s.telegramUserId), {
        id: s.id,
        role: s.role,
        expiresAt: s.expiresAt || null
      });
    }
  }

  static isAuthorizedSync(userId) {
    const id = String(userId);
    if (this.isOwnerSync(id)) return true;
    const session = this._cache.get(id);
    if (!session) return false;
    if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
      this._cache.delete(id);
      return false;
    }
    return true;
  }

  static isOwnerSync(userId) {
    const id = String(userId);
    const session = this._cache.get(id);
    if (session?.role === 'owner') return true;
    if (String(OWNER_TELEGRAM_ID) === id) return true;
    return false;
  }

  static getRoleSync(userId) {
    const id = String(userId);
    if (String(OWNER_TELEGRAM_ID) === id) return 'owner';
    return this._cache.get(id)?.role || null;
  }

  static async isMasterPasswordSet() {
    const data = await this._readAccessPayload();
    return Boolean(data.masterPasswordHash);
  }

  static async verifyMasterPassword(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return false;
    const access = await this._readAccessPayload();
    if (!access.masterPasswordHash) return false;
    return bcrypt.compare(trimmed, access.masterPasswordHash);
  }

  static async setMasterPassword(plainPassword) {
    const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    const data = await this._readAccessPayload();
    data.masterPasswordHash = hash;
    await this._writeAccessPayload(data);
    return true;
  }

  static async authenticate(userId, input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return { ok: false, error: 'empty' };

    if (RateLimitService.isBlocked(userId, 'auth')) {
      return { ok: false, error: 'rate_limited' };
    }

    const id = String(userId);
    const access = await this._readAccessPayload();

    if (access.masterPasswordHash && (await bcrypt.compare(trimmed, access.masterPasswordHash))) {
      await this._createSession(id, 'owner', null, OWNER_SESSION_TTL_MS);
      RateLimitService.clear(userId, 'auth');
      await AuditService.log('auth_login', { userId: id, detail: 'owner' });
      return { ok: true, role: 'owner' };
    }

    const invite = await this._findInviteByCode(trimmed);
    if (invite) {
      await this._consumeInvite(invite);
      const ttl = invite.expiresAt
        ? Math.max(new Date(invite.expiresAt).getTime() - Date.now(), 60_000)
        : GUEST_SESSION_TTL_MS;
      await this._createSession(id, invite.role || 'guest', invite.id, ttl);
      RateLimitService.clear(userId, 'auth');
      await AuditService.log('auth_login', { userId: id, detail: invite.role || 'guest' });
      return { ok: true, role: invite.role || 'guest' };
    }

    if (!access.masterPasswordHash && String(OWNER_TELEGRAM_ID) === id) {
      await this._createSession(id, 'owner', null, OWNER_SESSION_TTL_MS);
      RateLimitService.clear(userId, 'auth');
      await AuditService.log('auth_login', { userId: id, detail: 'owner_bootstrap' });
      return { ok: true, role: 'owner', bootstrap: true };
    }

    RateLimitService.recordFailure(userId, 'auth');
    return { ok: false, error: 'invalid' };
  }

  static async bootstrapOwnerSession(userId) {
    if (String(OWNER_TELEGRAM_ID) !== String(userId)) return false;
    const id = String(userId);
    if (this.isOwnerSync(id) && this._cache.has(id)) return true;
    try {
      await this._createSession(id, 'owner', null, OWNER_SESSION_TTL_MS);
    } catch (err) {
      if (!/duplicate key|23505/i.test(err.message)) throw err;
      await this.reloadCache();
    }
    return true;
  }

  static async createInvite({ role = 'guest', ttlHours = 24, maxUses = 1, label = '', createdBy }) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = ttlHours
      ? new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()
      : null;

    const invite = {
      id: crypto.randomUUID(),
      codeHash,
      role,
      label: label || null,
      expiresAt,
      maxUses,
      useCount: 0,
      createdBy: String(createdBy),
      revokedAt: null,
      createdAt: new Date().toISOString()
    };

    await this._saveInvite(invite);
    await AuditService.log('invite_create', {
      userId: String(createdBy),
      detail: `${role} ${ttlHours}h maxUses=${maxUses}`
    });
    return { code, invite };
  }

  static async listActiveSessions() {
    const sessions = await this._listSessionsRaw();
    const now = Date.now();
    return sessions.filter(
      (s) => !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt).getTime() > now)
    );
  }

  static async listInvites() {
    return this._listInvitesRaw();
  }

  static async revokeSession(sessionId) {
    await this._revokeSessionById(sessionId);
    await this.reloadCache();
    await AuditService.log('session_revoke', { detail: sessionId });
  }

  static async revokeInvite(inviteId) {
    await this._revokeInviteById(inviteId);
  }

  static async logout(userId) {
    const id = String(userId);
    await this._revokeSessionsForUser(id);
    this._cache.delete(id);
  }

  static async _readAccessPayload() {
    try {
      return (await JsonStore.read('access', {})) || {};
    } catch {
      return {};
    }
  }

  static async _writeAccessPayload(data) {
    await JsonStore.write('access', data);
  }

  static _getSupabaseClient() {
    const backend = StorageRegistry.getBackend();
    if (backend.name === 'supabase') return backend.getClient();
    if (backend.name === 'dual') return backend.getSupabase().getClient();
    return null;
  }

  static async _listSessionsRaw() {
    const client = this._getSupabaseClient();
    if (client) {
      const { data, error } = await client.from('access_sessions').select('*').order('started_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map(this._mapSessionRow);
    }
    const payload = await this._readAccessPayload();
    return payload.sessions || [];
  }

  static async _listInvitesRaw() {
    const client = this._getSupabaseClient();
    if (client) {
      const { data, error } = await client.from('access_invites').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map(this._mapInviteRow);
    }
    const payload = await this._readAccessPayload();
    return (payload.invites || []).filter((i) => !i.revokedAt);
  }

  static async _saveInvite(invite) {
    const client = this._getSupabaseClient();
    if (client) {
      const { error } = await client.from('access_invites').insert({
        id: invite.id,
        code_hash: invite.codeHash,
        role: invite.role,
        label: invite.label,
        expires_at: invite.expiresAt,
        max_uses: invite.maxUses,
        use_count: invite.useCount,
        created_by: invite.createdBy,
        revoked_at: invite.revokedAt
      });
      if (error) throw new Error(error.message);
      return;
    }
    const payload = await this._readAccessPayload();
    payload.invites = payload.invites || [];
    payload.invites.push(invite);
    await this._writeAccessPayload(payload);
  }

  static async _findInviteByCode(code) {
    const invites = await this._listInvitesRaw();
    const now = Date.now();
    for (const invite of invites) {
      if (invite.revokedAt) continue;
      if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= now) continue;
      if (invite.useCount >= invite.maxUses) continue;
      if (await bcrypt.compare(code, invite.codeHash)) return invite;
    }
    return null;
  }

  static async _consumeInvite(invite) {
    const client = this._getSupabaseClient();
    if (client) {
      const { error } = await client
        .from('access_invites')
        .update({ use_count: invite.useCount + 1 })
        .eq('id', invite.id);
      if (error) throw new Error(error.message);
      return;
    }
    const payload = await this._readAccessPayload();
    const row = (payload.invites || []).find((i) => i.id === invite.id);
    if (row) row.useCount = (row.useCount || 0) + 1;
    await this._writeAccessPayload(payload);
  }

  static async _createSession(telegramUserId, role, inviteId, ttlMs) {
    await this._revokeSessionsForUser(telegramUserId);
    const session = {
      id: crypto.randomUUID(),
      telegramUserId: String(telegramUserId),
      role,
      inviteId: inviteId || null,
      startedAt: new Date().toISOString(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null,
      revokedAt: null,
      lastSeenAt: new Date().toISOString()
    };

    const client = this._getSupabaseClient();
    if (client) {
      const { error } = await client.from('access_sessions').insert({
        id: session.id,
        telegram_user_id: session.telegramUserId,
        role: session.role,
        invite_id: session.inviteId,
        expires_at: session.expiresAt,
        last_seen_at: session.lastSeenAt
      });
      if (error) {
        if (error.code === '23505' || /duplicate key/i.test(error.message)) {
          await this.reloadCache();
          return;
        }
        throw new Error(error.message);
      }
    } else {
      const payload = await this._readAccessPayload();
      payload.sessions = payload.sessions || [];
      payload.sessions.push(session);
      await this._writeAccessPayload(payload);
    }

    this._cache.set(String(telegramUserId), {
      id: session.id,
      role: session.role,
      expiresAt: session.expiresAt
    });
  }

  static async _revokeSessionsForUser(telegramUserId) {
    const client = this._getSupabaseClient();
    const now = new Date().toISOString();
    if (client) {
      await client
        .from('access_sessions')
        .update({ revoked_at: now })
        .eq('telegram_user_id', String(telegramUserId))
        .is('revoked_at', null);
      return;
    }
    const payload = await this._readAccessPayload();
    for (const s of payload.sessions || []) {
      if (String(s.telegramUserId) === String(telegramUserId) && !s.revokedAt) {
        s.revokedAt = now;
      }
    }
    await this._writeAccessPayload(payload);
  }

  static async _revokeSessionById(sessionId) {
    const client = this._getSupabaseClient();
    const now = new Date().toISOString();
    if (client) {
      const { data } = await client.from('access_sessions').select('telegram_user_id').eq('id', sessionId).maybeSingle();
      await client.from('access_sessions').update({ revoked_at: now }).eq('id', sessionId);
      if (data?.telegram_user_id) this._cache.delete(String(data.telegram_user_id));
      return;
    }
    const payload = await this._readAccessPayload();
    for (const s of payload.sessions || []) {
      if (s.id === sessionId) {
        s.revokedAt = now;
        this._cache.delete(String(s.telegramUserId));
      }
    }
    await this._writeAccessPayload(payload);
  }

  static async _revokeInviteById(inviteId) {
    const client = this._getSupabaseClient();
    const now = new Date().toISOString();
    if (client) {
      await client.from('access_invites').update({ revoked_at: now }).eq('id', inviteId);
      return;
    }
    const payload = await this._readAccessPayload();
    const row = (payload.invites || []).find((i) => i.id === inviteId);
    if (row) row.revokedAt = now;
    await this._writeAccessPayload(payload);
  }

  static _mapSessionRow(r) {
    return {
      id: r.id,
      telegramUserId: r.telegram_user_id,
      role: r.role,
      inviteId: r.invite_id,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      lastSeenAt: r.last_seen_at
    };
  }

  static _mapInviteRow(r) {
    return {
      id: r.id,
      codeHash: r.code_hash,
      role: r.role,
      label: r.label,
      expiresAt: r.expires_at,
      maxUses: r.max_uses,
      useCount: r.use_count,
      createdBy: r.created_by,
      revokedAt: r.revoked_at,
      createdAt: r.created_at
    };
  }
}

module.exports = AccessService;
