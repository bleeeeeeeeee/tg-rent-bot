const crypto = require('crypto');

function computeContentHash(text) {
  const normalized = String(text || '').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

module.exports = { computeContentHash };
