const AccessService = require('./AccessService');

const ADMIN_SESSION_TTL_MS = 30 * 60 * 1000;

class AdminPanelService {
  static _sessions = new Map();

  static isActive(userId) {
    const row = this._sessions.get(String(userId));
    if (!row) return false;
    if (Date.now() > row.expiresAt) {
      this._sessions.delete(String(userId));
      return false;
    }
    return true;
  }

  static grant(userId) {
    this._sessions.set(String(userId), { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
  }

  static revoke(userId) {
    this._sessions.delete(String(userId));
  }

  static touch(userId) {
    if (this.isActive(userId)) {
      this.grant(userId);
    }
  }

  static async verifyMasterPassword(input) {
    return AccessService.verifyMasterPassword(input);
  }

  static async isMasterPasswordSet() {
    return AccessService.isMasterPasswordSet();
  }
}

module.exports = AdminPanelService;
