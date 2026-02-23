const BotService = require('./services/BotService');
const PostRepository = require('./services/PostRepository');
const SchedulerService = require('./services/SchedulerService');

const botService = new BotService(PostRepository);

// Scheduler will periodically check repository and publish posts
const scheduler = new SchedulerService(botService.bot, PostRepository, botService.postService);
scheduler.start();