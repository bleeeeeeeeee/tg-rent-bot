const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

class RateLimitService {
  static _buckets = new Map();

  static _key(userId, scope) {
    return `${scope}:${String(userId)}`;
  }

  static isBlocked(userId, scope = 'auth') {
    const row = this._buckets.get(this._key(userId, scope));
    if (!row) return false;
    if (Date.now() > row.until) {
      this._buckets.delete(this._key(userId, scope));
      return false;
    }
    return row.count >= MAX_ATTEMPTS;
  }

  static recordFailure(userId, scope = 'auth') {
    const k = this._key(userId, scope);
    const row = this._buckets.get(k) || { count: 0, until: Date.now() + WINDOW_MS };
    row.count += 1;
    row.until = Date.now() + WINDOW_MS;
    this._buckets.set(k, row);
    return row.count;
  }

  static clear(userId, scope = 'auth') {
    this._buckets.delete(this._key(userId, scope));
  }
}

module.exports = RateLimitService;
