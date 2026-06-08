const BotService = require('./services/BotService');
const PostRepository = require('./services/PostRepository');
const SchedulerService = require('./services/SchedulerService');
const AccessService = require('./services/AccessService');
const SyncService = require('./services/SyncService');
const { CHANNEL_ID, ADMIN_ID, OWNER_TELEGRAM_ID, BOT_TOKEN, STORAGE_BACKEND } = require('./config');
const ExistingPosts = require('./services/ExistingPosts');
const SecretsService = require('./services/SecretsService');
const SettingsService = require('./services/SettingsService');
const AiProviderRegistry = require('./ai/AiProviderRegistry');

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

(async () => {
  try {
    console.log('\n🤖 === TELEGRAM BOT STARTED ===\n');
    console.log('⚙️  Configuration:');
    console.log(`   BOT_TOKEN: ${BOT_TOKEN ? '✅ set' : '❌ not set'}`);
    console.log(`   OWNER_TELEGRAM_ID: ${OWNER_TELEGRAM_ID || ADMIN_ID}`);
    console.log(`   CHANNEL_ID: ${CHANNEL_ID}`);
    console.log(`   STORAGE_BACKEND: ${STORAGE_BACKEND}`);

    await ExistingPosts.migrateSchema();
    await SecretsService.seedFromEnv();
    await AccessService.init();
    await AiProviderRegistry.refreshCustom();
    await SyncService.init();

    const settings = await SettingsService.getAll();
    const activeAi = await SettingsService.getActiveProvider();
    console.log(`   AI provider: ${activeAi || 'not set'}`);
    console.log(`   Timezone: ${settings.general?.timezone}`);

    const postCount = await ExistingPosts.count();
    const pendingCount = (await PostRepository.getAllPending()).length;
    console.log(`\n📊 Posts in DB: ${postCount} (${pendingCount} scheduled)`);
    console.log('\nMode: channel monitoring enabled 🔄\n');

    const botService = new BotService(PostRepository);
    console.log('✅ Telegram polling active\n');
    const scheduler = new SchedulerService(botService.bot, PostRepository, botService.postService);
    scheduler.start();
  } catch (err) {
    console.error('❌ Ошибка при запуске:', err.message);
    process.exit(1);
  }
})();
