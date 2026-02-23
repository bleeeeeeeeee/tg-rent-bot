class SchedulerService {
    constructor(bot, postRepository, publishService) {
        this.bot = bot;
        this.postRepository = postRepository;
        this.publishService = publishService;
    }

    start() {
        setInterval(async () => {
            const now = new Date();

            const posts = await this.postRepository.getScheduled();

            for (const post of posts) {
                if (new Date(post.publishAt) <= now) {
                    await this.publishService.publish(post.chatId, post.messageId);
                    await this.postRepository.markAsPublished(post.id);
                }
            }

        }, 30000);
    }
}

module.exports = SchedulerService;