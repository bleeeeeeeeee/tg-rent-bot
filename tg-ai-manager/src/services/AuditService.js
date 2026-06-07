const JsonStore = require('../storage/JsonStore');

const MAX_ENTRIES = 100;

class AuditService {
  static async _readLog() {
    try {
      const data = await JsonStore.read('access', {});
      return Array.isArray(data.auditLog) ? data.auditLog : [];
    } catch {
      return [];
    }
  }

  static async _writeLog(entries) {
    const data = (await JsonStore.read('access', {})) || {};
    data.auditLog = entries.slice(0, MAX_ENTRIES);
    await JsonStore.write('access', data);
  }

  static async log(action, { userId = null, detail = null } = {}) {
    const entries = await this._readLog();
    entries.unshift({
      at: new Date().toISOString(),
      action,
      userId: userId != null ? String(userId) : null,
      detail: detail || null
    });
    await this._writeLog(entries);
  }

  static async listRecent(limit = 20) {
    return (await this._readLog()).slice(0, limit);
  }
}

module.exports = AuditService;
