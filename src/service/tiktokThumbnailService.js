import axios from 'axios';

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_ENRICHED_POSTS = 10;
const thumbnailCache = new Map();

function extractUrl(value) {
  if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractUrl(item);
      if (url) return url;
    }
  }
  if (value && typeof value === 'object') {
    return extractUrl(
      value.url || value.src || value.url_list || value.urlList || value.urls
    );
  }
  return '';
}

export function findExistingTikTokThumbnail(post) {
  const video = post?.video && typeof post.video === 'object' ? post.video : {};
  const candidates = [
    post?.thumbnail_url,
    post?.thumbnail,
    post?.cover_url,
    post?.cover,
    video.dynamicCover,
    video.originCover,
    video.cover,
  ];
  for (const candidate of candidates) {
    const url = extractUrl(candidate);
    if (url) return url;
  }
  return '';
}

export function buildTikTokPostUrl(username, videoId) {
  const normalizedUsername = String(username || '').trim().replace(/^@+/, '');
  const normalizedVideoId = String(videoId || '').trim();
  if (!/^[A-Za-z0-9._]{1,32}$/.test(normalizedUsername)) return '';
  if (!/^\d{8,32}$/.test(normalizedVideoId)) return '';
  return `https://www.tiktok.com/@${normalizedUsername}/video/${normalizedVideoId}`;
}

async function fetchOEmbedThumbnail(postUrl) {
  const cached = thumbnailCache.get(postUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  try {
    const response = await axios.get('https://www.tiktok.com/oembed', {
      params: { url: postUrl },
      timeout: 8000,
      headers: { Accept: 'application/json' },
    });
    const thumbnailUrl = extractUrl(response.data?.thumbnail_url);
    thumbnailCache.set(postUrl, {
      url: thumbnailUrl,
      expiresAt: Date.now() + (thumbnailUrl ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
    });
    return thumbnailUrl;
  } catch {
    thumbnailCache.set(postUrl, {
      url: '',
      expiresAt: Date.now() + FAILURE_TTL_MS,
    });
    return '';
  }
}

export async function enrichTikTokPostThumbnails(posts, username) {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  return Promise.all(
    posts.map(async (post, index) => {
      const existingThumbnail = findExistingTikTokThumbnail(post);
      if (existingThumbnail) {
        return { ...post, thumbnail_url: existingThumbnail };
      }
      if (index >= MAX_ENRICHED_POSTS) return post;

      const postUrl = buildTikTokPostUrl(
        username,
        post?.video_id || post?.id || post?.aweme_id,
      );
      if (!postUrl) return post;

      const thumbnailUrl = await fetchOEmbedThumbnail(postUrl);
      return thumbnailUrl
        ? { ...post, thumbnail_url: thumbnailUrl, url: postUrl }
        : { ...post, url: postUrl };
    }),
  );
}
