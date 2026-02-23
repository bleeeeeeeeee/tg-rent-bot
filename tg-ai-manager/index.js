const BotService = require('./services/BotService');
const PostRepository = require('./services/PostRepository');
const SchedulerService = require('./services/SchedulerService');

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

const botService = new BotService(PostRepository);

const scheduler = new SchedulerService(botService.bot, PostRepository, botService.postService);
scheduler.start();