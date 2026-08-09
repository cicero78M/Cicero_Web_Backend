import { env } from '../config/env.js';
import { fetchInstagramProfile } from './instagramApi.js';
import { fetchTiktokProfile } from './tiktokRapidService.js';

export class ClaimSocialProfileError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ClaimSocialProfileError';
    this.code = code;
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numberOrNull(value) {
  const number = Number(value);
  return value !== undefined && value !== null && Number.isFinite(number)
    ? number
    : null;
}

function buildDataQuality(profile) {
  const definitions = [
    ['profile_name', profile.profile_name],
    ['avatar_url', profile.avatar_url],
    ['followers', profile.followers],
    ['following', profile.following],
    ['content_count', profile.content_count],
  ];
  const components = definitions.map(([field, value]) => ({
    field,
    available: value !== null && value !== undefined && value !== '',
    points: value !== null && value !== undefined && value !== '' ? 20 : 0,
  }));
  const score = components.reduce((total, item) => total + item.points, 0);
  const label =
    score === 100 ? 'complete' : score >= 60 ? 'partial' : 'limited';
  return {
    score,
    label,
    components,
    explanation:
      'Skor menunjukkan kelengkapan data profil yang tersedia, bukan keaslian akun.',
  };
}

function mapInstagramProfile(raw, username) {
  if (!raw || typeof raw !== 'object' || !raw.username) return null;
  return {
    platform: 'instagram',
    username,
    found: true,
    profile_name: firstDefined(raw.full_name, null),
    avatar_url: firstDefined(raw.profile_pic_url_hd, raw.profile_pic_url, null),
    is_private: Boolean(raw.is_private),
    is_verified: Boolean(raw.is_verified),
    followers: numberOrNull(
      firstDefined(raw.followers_count, raw.follower_count)
    ),
    following: numberOrNull(raw.following_count),
    content_count: numberOrNull(firstDefined(raw.media_count, raw.posts_count)),
  };
}

function mapTiktokProfile(raw, username) {
  if (!raw || typeof raw !== 'object' || !raw.username) return null;
  return {
    platform: 'tiktok',
    username,
    found: true,
    profile_name: firstDefined(raw.nickname, null),
    avatar_url: firstDefined(raw.avatar_url, null),
    is_private: Boolean(firstDefined(raw.is_private, false)),
    is_verified: Boolean(raw.verified),
    followers: numberOrNull(raw.follower_count),
    following: numberOrNull(raw.following_count),
    content_count: numberOrNull(raw.video_count),
  };
}

function classifyUpstreamError(error) {
  if (error?.code === 'RAPIDAPI_KEY_MISSING')
    return 'configuration_unavailable';
  if (error?.statusCode === 404 || error?.response?.status === 404) {
    return 'not_found';
  }
  if (error?.statusCode === 429 || error?.response?.status === 429) {
    return 'rate_limited';
  }
  return 'upstream_unavailable';
}

export async function fetchClaimSocialProfile(platform, username) {
  if (!env.RAPIDAPI_KEY) {
    throw new ClaimSocialProfileError('configuration_unavailable');
  }

  try {
    const raw =
      platform === 'instagram'
        ? await fetchInstagramProfile(username)
        : await fetchTiktokProfile(username);
    const profile =
      platform === 'instagram'
        ? mapInstagramProfile(raw, username)
        : mapTiktokProfile(raw, username);
    if (!profile) throw new ClaimSocialProfileError('not_found');
    return { ...profile, data_quality: buildDataQuality(profile) };
  } catch (error) {
    if (error instanceof ClaimSocialProfileError) throw error;
    throw new ClaimSocialProfileError(classifyUpstreamError(error));
  }
}
