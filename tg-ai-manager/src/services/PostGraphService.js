const ExistingPosts = require('./ExistingPosts');

class PostGraphService {
  static async getRepliesTo(parentId) {
    const posts = await ExistingPosts.getAll();
    const pid = Number(parentId);
    return posts
      .filter((p) => p.replyTo === pid && p.lifecycleStatus !== 'deleted')
      .sort((a, b) => a.id - b.id);
  }

  static async getAllRepliesTo(parentId) {
    const posts = await ExistingPosts.getAll();
    const pid = Number(parentId);
    return posts.filter((p) => p.replyTo === pid).sort((a, b) => a.id - b.id);
  }

  static async getParent(post) {
    if (!post?.replyTo) return null;
    return ExistingPosts.getById(post.replyTo);
  }

  static async buildReplyContext(postId) {
    const post = await ExistingPosts.getById(postId);
    if (!post) return null;

    const parent = await this.getParent(post);
    const children = await this.getAllRepliesTo(postId);

    return {
      post,
      parent,
      parentMissing: Boolean(post.replyTo && !parent),
      children,
      activeChildren: children.filter((c) => c.lifecycleStatus !== 'deleted')
    };
  }
}

module.exports = PostGraphService;
