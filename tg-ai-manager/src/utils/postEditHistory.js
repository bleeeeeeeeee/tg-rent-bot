const MAX_ENTRIES = 40;

function normalizeEditHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => e && typeof e.post === 'string')
    .map((e) => ({
      at: e.at || null,
      post: e.post,
      media: e.media ?? null,
      source: e.source || 'channel'
    }))
    .slice(-MAX_ENTRIES);
}

function appendEditSnapshot(existing, source = 'channel') {
  const history = normalizeEditHistory(existing.editHistory);
  const entry = {
    at: existing.editedAt || existing.added || new Date().toISOString(),
    post: existing.post || '',
    media: existing.media ?? null,
    source
  };
  const last = history[history.length - 1];
  if (last && last.post === entry.post) return history;
  history.push(entry);
  return history.slice(-MAX_ENTRIES);
}

function countEdits(post) {
  if (!post) return 0;
  const historyLen = normalizeEditHistory(post.editHistory).length;
  if (historyLen > 0) return historyLen;
  if (post.postOriginal && post.postOriginal !== (post.post || '')) return 1;
  if (post.lifecycleStatus === 'edited') return 1;
  return 0;
}

function buildEditTimeline(post) {
  if (!post) return [];
  const timeline = [];
  const history = normalizeEditHistory(post.editHistory);

  if (post.postOriginal && post.postOriginal !== (post.post || '')) {
    timeline.push({
      kind: 'original',
      at: post.added,
      post: post.postOriginal,
      source: 'publish'
    });
  }

  for (const entry of history) {
    timeline.push({
      kind: 'snapshot',
      at: entry.at,
      post: entry.post,
      source: entry.source
    });
  }

  const currentPost = post.post || '';
  const lastSnapshot = timeline[timeline.length - 1];
  if (
    post.lifecycleStatus !== 'deleted' &&
    currentPost &&
    (!lastSnapshot || lastSnapshot.post !== currentPost)
  ) {
    timeline.push({
      kind: 'current',
      at: post.editedAt || post.added,
      post: currentPost,
      source: 'current'
    });
  }

  return timeline;
}

function hasEditHistory(post) {
  return countEdits(post) > 0 || post?.lifecycleStatus === 'edited';
}

module.exports = {
  MAX_ENTRIES,
  normalizeEditHistory,
  appendEditSnapshot,
  countEdits,
  buildEditTimeline,
  hasEditHistory
};
