const http = require('http');
const StorageRegistry = require('./storage/StorageRegistry');
const SyncService = require('./services/SyncService');

let server = null;
let webhookBot = null;
let webhookPath = '/telegram/webhook';
let webhookSecret = '';

function readRequestBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function configureTelegramWebhook({ bot, path, secret }) {
  webhookBot = bot;
  webhookPath = path || '/telegram/webhook';
  webhookSecret = secret || '';
}

async function handleTelegramWebhook(req, res) {
  if (!webhookBot) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('webhook not configured');
    return;
  }

  if (webhookSecret) {
    const token = req.headers['x-telegram-bot-api-secret-token'];
    if (token !== webhookSecret) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('forbidden');
      return;
    }
  }

  try {
    const raw = await readRequestBody(req);
    const update = JSON.parse(raw);
    webhookBot.processUpdate(update);
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } catch (err) {
    console.error('[webhook] process error:', err.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('error');
  }
}

function startHealthServer(port = Number(process.env.HEALTH_PORT || process.env.PORT) || 8080) {
  if (server) return server;

  server = http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];

    if (req.method === 'POST' && path === webhookPath) {
      return handleTelegramWebhook(req, res);
    }

    if (path !== '/health' && path !== '/') {
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
      instanceId: sync.instanceId,
      telegram: webhookBot ? 'webhook' : 'polling'
    };

    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`🏥 HTTP server: http://0.0.0.0:${port}/health`);
    if (webhookBot) {
      console.log(`🔗 Telegram webhook path: ${webhookPath}`);
    }
  });

  return server;
}

function stopHealthServer() {
  return new Promise((resolve) => {
    webhookBot = null;
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

module.exports = {
  startHealthServer,
  stopHealthServer,
  configureTelegramWebhook
};
