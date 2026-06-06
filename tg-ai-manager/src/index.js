const BotService = require('./services/BotService');
const PostRepository = require('./services/PostRepository');
const SchedulerService = require('./services/SchedulerService');
const { CHANNEL_ID, ADMIN_ID, BOT_TOKEN } = require('./config');
const ExistingPosts = require('./services/ExistingPosts');
const SecretsService = require('./services/SecretsService');
const SettingsService = require('./services/SettingsService');

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

(async () => {
  try {
    console.log('\n🤖 === TELEGRAM BOT STARTED ===\n');
    console.log('⚙️  Configuration:');
    console.log(`   BOT_TOKEN: ${BOT_TOKEN ? '✅ set' : '❌ not set'}`);
    console.log(`   ADMIN_ID: ${ADMIN_ID}`);
    console.log(`   CHANNEL_ID: ${CHANNEL_ID}`);

    await ExistingPosts.migrateSchema();
    await SecretsService.seedFromEnv();

    const settings = await SettingsService.getAll();
    const activeAi = await SettingsService.getActiveProvider();
    console.log(`   AI provider: ${activeAi || 'not set'}`);
    console.log(`   Timezone: ${settings.general?.timezone}`);

    const postCount = await ExistingPosts.count();
    const pendingCount = (await PostRepository.getAllPending()).length;
    console.log(`\n📊 Posts in DB: ${postCount} (${pendingCount} scheduled)`);
    console.log('\nMode: channel monitoring enabled 🔄\n');

    const botService = new BotService(PostRepository);
    const scheduler = new SchedulerService(botService.bot, PostRepository, botService.postService);
    scheduler.start();
  } catch (err) {
    console.error('❌ Ошибка при запуске:', err.message);
    process.exit(1);
  }
})();
