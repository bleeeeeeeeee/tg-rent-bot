#!/usr/bin/env node
const ExistingPosts = require('./src/services/ExistingPosts');

(async () => {
  try {
    console.log('\n📊 === POST DATABASE STATUS ===\n');
    
    const posts = await ExistingPosts.getAll();
    const count = await ExistingPosts.count();
    
    console.log(`Total posts: ${count}`);
    
    if (count === 0) {
      console.log('\n✅ Database is empty and ready for posts\n');
      return;
    }

    console.log('\n📋 Last 5 posts:\n');
    const recent = posts.slice(-5).reverse();
    
    recent.forEach(p => {
      const arrow = p.replyTo ? ` ↩️ (reply to #${p.replyTo})` : '';
      const media = p.media ? `${p.media.type} x${p.media.count}` : 'no media';
      const text = p.post ? p.post.substring(0, 50).replace(/\n/g, ' ') : '(empty)';
      console.log(`  #${p.id.toString().padEnd(4)} | ${media.padEnd(15)} | ${text}...${arrow}`);
    });
    
    console.log('\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
