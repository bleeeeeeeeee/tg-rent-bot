const fs = require('fs').promises;
const path = require('path');
const { COLLECTIONS } = require('./collections');

const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '../../storage');

class FileBackend {
  constructor() {
    this.name = 'file';
  }

  _path(key) {
    const meta = COLLECTIONS[key];
    if (!meta) throw new Error(`Unknown collection: ${key}`);
    return path.join(STORAGE_DIR, meta.file);
  }

  async read(key, defaultValue = null) {
    try {
      const raw = await fs.readFile(this._path(key), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return defaultValue;
      throw err;
    }
  }

  async write(key, data) {
    const filePath = this._path(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  async healthCheck() {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    return { ok: true, backend: 'file' };
  }

  async exportAll() {
    const out = {};
    for (const key of Object.keys(COLLECTIONS)) {
      out[key] = await this.read(key, null);
    }
    return out;
  }
}

module.exports = FileBackend;
