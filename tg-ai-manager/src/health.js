const http = require('http');
const StorageRegistry = require('./storage/StorageRegistry');
const SyncService = require('./services/SyncService');

let server = null;

function startHealthServer(port = Number(process.env.HEALTH_PORT) || 8080) {
  if (server) return server;

  server = http.createServer(async (req, res) => {
    if (req.url !== '/health' && req.url !== '/') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }

    let storageOk = false;
    let storageError = null;
    try {
      const health = await StorageRegistry.getBackend().healthCheck();
      storageOk = health.ok !== false;
      storageError = health.error || null;
    } catch (err) {
      storageError = err.message;
    }

    const sync = SyncService.getStatus();
    const ok = storageOk;
    const body = {
      ok,
      uptime: Math.floor(process.uptime()),
      storage: storageOk ? 'ok' : storageError,
      sync: sync.connected ? 'connected' : 'offline',
      instanceId: sync.instanceId
    };

    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🏥 Health check: http://0.0.0.0:${port}/health`);
  });

  if (server.unref) server.unref();
  return server;
}

function stopHealthServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

module.exports = { startHealthServer, stopHealthServer };
