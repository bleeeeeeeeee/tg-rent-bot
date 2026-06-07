/**
 * @typedef {Object} StorageBackend
 * @property {string} name
 * @property {(key: string, defaultValue?: *) => Promise<*>} read
 * @property {(key: string, data: *) => Promise<*>} write
 * @property {() => Promise<{ ok: boolean, backend: string, error?: string }>} healthCheck
 */

module.exports = {};
