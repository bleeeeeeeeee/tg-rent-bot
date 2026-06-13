const BotService = require('./services/BotService');
const PostRepository = require('./services/PostRepository');
const SchedulerService = require('./services/SchedulerService');
const AccessService = require('./services/AccessService');
const SyncService = require('./services/SyncService');
const { startHealthServer, stopHealthServer, configureTelegramWebhook } = require('./health');
const {
  CHANNEL_ID,
  ADMIN_ID,
  OWNER_TELEGRAM_ID,
  BOT_TOKEN,
  STORAGE_BACKEND,
  BOT_MODE,
  WEBHOOK_URL,
  WEBHOOK_SECRET
} = require('./config');
const {
  resolveWebhookMode,
  parseWebhookUrl,
  registerTelegramWebhook,
  unregisterTelegramWebhook
} = require('./telegramWebhook');
const ExistingPosts = require('./services/ExistingPosts');
const ChannelSyncService = require('./services/ChannelSyncService');
const SecretsService = require('./services/SecretsService');
const SettingsService = require('./services/SettingsService');
const AiProviderRegistry = require('./ai/AiProviderRegistry');

let botService = null;
let scheduler = null;

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

async function shutdown(signal) {
  console.log(`\n⏹ ${signal} — останавливаю бота…`);
  try {
    if (botService?.usePolling) {
      await botService.bot.stopPolling();
    } else if (botService?.bot) {
      await unregisterTelegramWebhook(botService.bot);
    }
    await stopHealthServer();
  } catch (err) {
    console.error('Shutdown error:', err.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
  try {
    console.log('\n🤖 === TELEGRAM BOT STARTED ===\n');
    console.log('⚙️  Configuration:');
    console.log(`   BOT_TOKEN: ${BOT_TOKEN ? '✅ set' : '❌ not set'}`);
    console.log(`   OWNER_TELEGRAM_ID: ${OWNER_TELEGRAM_ID || ADMIN_ID}`);
    console.log(`   CHANNEL_ID: ${CHANNEL_ID}`);
    console.log(`   STORAGE_BACKEND: ${STORAGE_BACKEND}`);

    const { useWebhook, url: webhookUrl } = resolveWebhookMode({
      BOT_MODE,
      WEBHOOK_URL
    });
    console.log(`   BOT_MODE: ${useWebhook ? 'webhook' : 'polling'}`);
    if (useWebhook) {
      console.log(`   WEBHOOK_URL: ${webhookUrl || '(missing!)'}`);
    }

    if (!BOT_TOKEN?.trim()) {
      console.error('\n❌ BOT_TOKEN не задан.');
      console.error('   На Northflank: сервис → Variables → Runtime → добавьте BOT_TOKEN и остальные переменные.');
      console.error('   Файл .env в Docker не используется — только переменные окружения платформы.\n');
      process.exit(1);
    }
    if (!String(OWNER_TELEGRAM_ID || ADMIN_ID).trim()) {
      console.error('\n❌ OWNER_TELEGRAM_ID (или ADMIN_ID) не задан.\n');
      process.exit(1);
    }
    if (!CHANNEL_ID?.trim()) {
      console.error('\n❌ CHANNEL_ID не задан (например @voidpreshade).\n');
      process.exit(1);
    }
    if (STORAGE_BACKEND === 'supabase' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)) {
      console.error('\n❌ STORAGE_BACKEND=supabase, но нет SUPABASE_URL или SUPABASE_SERVICE_KEY.\n');
      process.exit(1);
    }
    if (useWebhook && !webhookUrl) {
      console.error('\n❌ Webhook mode: задайте WEBHOOK_URL (полный HTTPS URL, например https://app.example.com/telegram/webhook).\n');
      process.exit(1);
    }
    if (useWebhook && process.env.HEALTH_PORT === '0') {
      console.error('\n❌ Webhook mode: HEALTH_PORT=0 отключает HTTP-сервер — webhook не будет принимать апдейты.\n');
      process.exit(1);
    }

    if (process.env.HEALTH_PORT !== '0') {
      startHealthServer();
    }

    await ExistingPosts.migrateSchema();
    await SyncService.init();
    await SecretsService.seedFromEnv();
    await AccessService.init();
    await AiProviderRegistry.refreshCustom();

    botService = new BotService(PostRepository, { usePolling: !useWebhook });

    if (useWebhook) {
      const { fullUrl, path } = parseWebhookUrl(webhookUrl);
      configureTelegramWebhook({
        bot: botService.bot,
        path,
        secret: WEBHOOK_SECRET
      });
    }

    const settings = await SettingsService.getAll();
    const activeAi = await SettingsService.getActiveProvider();
    console.log(`   AI provider: ${activeAi || 'not set'}`);
    console.log(`   Timezone: ${settings.general?.timezone}`);

    const postCount = await ExistingPosts.count();
    const pendingCount = (await PostRepository.getAllPending()).length;
    console.log(`\n📊 Posts in DB: ${postCount} (${pendingCount} scheduled)`);

    if (postCount === 0 && ChannelSyncService.canSync()) {
      console.log('📥 Archive empty — starting background channel import…');
      ChannelSyncService.syncChannel()
        .then((result) => {
          console.log(
            `[ChannelSync] Background import done: channel=${result.channelScanned} imported=${result.imported} archive=${result.archiveTotal}`
          );
        })
        .catch((err) => console.error('[ChannelSync] Background import failed:', err.message));
    } else if (postCount === 0) {
      console.log(
        '⚠️  Archive empty. Add TG_API_ID, TG_API_HASH, TG_SESSION for import, or use History → Sync in bot.'
      );
    }

    console.log('\nMode: channel monitoring enabled 🔄\n');

    if (useWebhook) {
      const { fullUrl } = parseWebhookUrl(webhookUrl);
      await registerTelegramWebhook(botService.bot, fullUrl, WEBHOOK_SECRET);
      console.log(`✅ Telegram webhook registered: ${fullUrl}\n`);
    } else {
      console.log('✅ Telegram polling active\n');
    }

    scheduler = new SchedulerService(botService.bot, PostRepository, botService.postService);
    scheduler.start();
  } catch (err) {
    console.error('❌ Ошибка при запуске:', err.message);
    process.exit(1);
  }
})();
