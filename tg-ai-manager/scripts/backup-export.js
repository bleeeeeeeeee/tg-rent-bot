#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const StorageRegistry = require('../src/storage/StorageRegistry');

(async () => {
  const outDir = path.join(__dirname, '../storage/backups');
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const data = await StorageRegistry.getFileBackend().exportAll();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Backup saved: ${file}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
