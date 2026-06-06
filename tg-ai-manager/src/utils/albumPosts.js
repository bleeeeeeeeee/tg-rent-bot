function hasListContent(post) {
  return Boolean(post.title?.trim() || post.post?.trim());
}

function pickAlbumPrimary(group) {
  if (!group?.length) return null;
  const withText = group.find(hasListContent);
  if (withText) return withText;
  return [...group].sort((a, b) => a.id - b.id)[0];
}

function sameSecond(a, b) {
  return Math.floor(new Date(a).getTime() / 1000) === Math.floor(new Date(b).getTime() / 1000);
}

function isMediaOnly(post) {
  return Boolean(post.media) && !hasListContent(post);
}

const ALBUM_TIME_MS = 3 * 60 * 1000;
const ALBUM_ID_RANGE = 25;

function findAlbumPrimaryByProximity(post, allPosts) {
  if (!isMediaOnly(post)) return null;

  const t = new Date(post.added).getTime();
  let best = null;

  for (const p of allPosts) {
    if (p.id === post.id || !hasListContent(p)) continue;
    const dt = Math.abs(new Date(p.added).getTime() - t);
    if (dt > ALBUM_TIME_MS) continue;
    const idDiff = Math.abs(p.id - post.id);
    if (idDiff === 0 || idDiff > ALBUM_ID_RANGE) continue;
    if (!best || idDiff < best.idDiff) best = { id: p.id, idDiff };
  }

  return best?.id ?? null;
}

function inferAlbumPrimaryId(post, allPosts) {
  if (post.albumPrimaryId) return post.albumPrimaryId;

  if (post.mediaGroupId) {
    const group = allPosts.filter((p) => p.mediaGroupId === post.mediaGroupId);
    if (group.length > 1) {
      const primary = pickAlbumPrimary(group);
      if (primary && primary.id !== post.id) return primary.id;
    }
  }

  if (!isMediaOnly(post)) return null;

  const proximity = findAlbumPrimaryByProximity(post, allPosts);
  if (proximity) return proximity;

  const peers = allPosts.filter(
    (p) => p.id !== post.id && sameSecond(p.added, post.added)
  );
  if (peers.length === 0) return null;

  const withContent = peers.filter(hasListContent);
  if (withContent.length === 0) return null;

  const primary = pickAlbumPrimary(withContent);
  return primary?.id !== post.id ? primary.id : null;
}

function shouldHideFromList(post, allPosts) {
  return Boolean(inferAlbumPrimaryId(post, allPosts));
}

function getAlbumParts(primaryPost, allPosts) {
  if (!primaryPost) return [];
  const primaryId = Number(primaryPost.id);

  return allPosts
    .filter((p) => {
      if (p.id === primaryId) return false;
      if (p.albumPrimaryId === primaryId) return true;
      if (
        primaryPost.mediaGroupId &&
        p.mediaGroupId === primaryPost.mediaGroupId
      ) {
        return true;
      }
      if (isMediaOnly(p) && inferAlbumPrimaryId(p, allPosts) === primaryId) {
        return true;
      }
      return false;
    })
    .sort((a, b) => a.id - b.id);
}

function countAlbumMedia(primaryPost, allPosts) {
  return 1 + getAlbumParts(primaryPost, allPosts).length;
}

function isEmptyPost(post) {
  return (
    !post?.post?.trim() &&
    !post?.title?.trim() &&
    !post?.mainIdea?.trim() &&
    !post?.media
  );
}

module.exports = {
  hasListContent,
  pickAlbumPrimary,
  isMediaOnly,
  isEmptyPost,
  inferAlbumPrimaryId,
  findAlbumPrimaryByProximity,
  shouldHideFromList,
  getAlbumParts,
  countAlbumMedia,
  sameSecond
};
