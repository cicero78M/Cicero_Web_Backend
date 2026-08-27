import axios from 'axios';
import Bottleneck from 'bottleneck';

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const METRICS_TTL_MS = 30 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const MAX_ENRICHED_POSTS = 10;
const thumbnailCache = new Map();
const metadataCache = new Map();
const tikWmLimiter = new Bottleneck({ maxConcurrent: 1, minTime: 1100 });

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

function toMetric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function fetchTikWmMetadata(postUrl) {
  const cached = metadataCache.get(postUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const response = await tikWmLimiter.schedule(() =>
      axios.get('https://www.tikwm.com/api/', {
        params: { url: postUrl, hd: 0 },
        timeout: 8000,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }),
    );
    const payload = response.data?.code === 0 ? response.data?.data : null;
    const data = payload
      ? {
          thumbnail_url: extractUrl(
            payload.cover || payload.origin_cover || payload.ai_dynamic_cover,
          ),
          view_count: toMetric(payload.play_count),
          like_count: toMetric(payload.digg_count),
          comment_count: toMetric(payload.comment_count),
          share_count: toMetric(payload.share_count),
        }
      : null;
    metadataCache.set(postUrl, {
      data,
      expiresAt: Date.now() + (data ? METRICS_TTL_MS : FAILURE_TTL_MS),
    });
    return data;
  } catch {
    metadataCache.set(postUrl, {
      data: null,
      expiresAt: Date.now() + FAILURE_TTL_MS,
    });
    return null;
  }
}

export async function enrichTikTokPostThumbnails(posts, username) {
  if (!Array.isArray(posts) || posts.length === 0) return [];

  const enrichedPosts = [];
  for (const [index, post] of posts.entries()) {
      const existingThumbnail = findExistingTikTokThumbnail(post);
      const existingViewCount = toMetric(
        post?.view_count ?? post?.play_count ?? post?.stats?.playCount,
      );
      if (existingThumbnail && existingViewCount !== undefined) {
        enrichedPosts.push({ ...post, thumbnail_url: existingThumbnail });
        continue;
      }
      if (index >= MAX_ENRICHED_POSTS) {
        enrichedPosts.push(post);
        continue;
      }

      const postUrl = buildTikTokPostUrl(
        username,
        post?.video_id || post?.id || post?.aweme_id,
      );
      if (!postUrl) {
        enrichedPosts.push(post);
        continue;
      }

      const metadata = await fetchTikWmMetadata(postUrl);
      const thumbnailUrl =
        existingThumbnail ||
        metadata?.thumbnail_url ||
        (await fetchOEmbedThumbnail(postUrl));
      enrichedPosts.push({
        ...post,
        ...(metadata || {}),
        ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
        url: postUrl,
      });
  }
  return enrichedPosts;
}
