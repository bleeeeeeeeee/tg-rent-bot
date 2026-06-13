const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs/promises');

const StorageRegistry = require('../src/storage/StorageRegistry');
const FileBackend = require('../src/storage/FileBackend');
const UserSettingsService = require('../src/services/UserSettingsService');
const SettingsService = require('../src/services/SettingsService');

test('UserSettingsService stores per-user locale independently', async () => {
  const tmpDir = path.join(__dirname, '.tmp-user-settings');
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const prevDir = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = tmpDir;
  StorageRegistry.reset();
  StorageRegistry.useBackend(StorageRegistry.getFileBackend());

  try {
    await SettingsService.setLocale('ru');
    await UserSettingsService.setLocale(111, 'en');
    await UserSettingsService.setLocale(222, 'ru');

    assert.equal(await UserSettingsService.getLocale(111), 'en');
    assert.equal(await UserSettingsService.getLocale(222), 'ru');
    assert.equal(await SettingsService.getLocale(), 'ru');
  } finally {
    process.env.STORAGE_DIR = prevDir;
    StorageRegistry.reset();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('UserSettingsService seeds from global defaults on ensureUser', async () => {
  const tmpDir = path.join(__dirname, '.tmp-user-settings-seed');
  await fs.rm(tmpDir, { recursive: true, force: true });
  await fs.mkdir(tmpDir, { recursive: true });

  const prevDir = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = tmpDir;
  StorageRegistry.reset();
  StorageRegistry.useBackend(StorageRegistry.getFileBackend());

  try {
    await SettingsService.setTimezone('Asia/Tokyo');
    await SettingsService.setUiStyle({ navStyle: 'arrows', useEmojis: false });

    const prefs = await UserSettingsService.ensureUser(999);
    assert.equal(prefs.general.timezone, 'Asia/Tokyo');
    assert.equal(prefs.ui.navStyle, 'arrows');
    assert.equal(prefs.ui.useEmojis, false);
  } finally {
    process.env.STORAGE_DIR = prevDir;
    StorageRegistry.reset();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
