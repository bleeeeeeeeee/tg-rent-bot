const StorageRegistry = require('./StorageRegistry');

/** Unified read/write for JSON document collections */
class JsonStore {
  static read(key, defaultValue = null) {
    return StorageRegistry.getBackend().read(key, defaultValue);
  }

  static write(key, data) {
    return StorageRegistry.getBackend().write(key, data);
  }

  static healthCheck() {
    return StorageRegistry.getBackend().healthCheck();
  }

  static exportAll() {
    const backend = StorageRegistry.getBackend();
    if (typeof backend.exportAll === 'function') {
      return backend.exportAll();
    }
    return StorageRegistry.getFileBackend().exportAll();
  }
}

module.exports = JsonStore;
