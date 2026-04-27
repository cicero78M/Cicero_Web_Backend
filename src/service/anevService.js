import redis from '../config/redis.js';
import { findById as findClientById } from '../model/clientModel.js';
import { getInstaPostCount, getTiktokPostCount } from './postCountService.js';
import { query } from '../repository/db.js';
import { getUserDirectoryUsers } from './userDirectoryService.js';

const TTL_SEC = 60;
export const ALLOWED_TIME_RANGES = ['today', '7d', '30d', '90d', 'custom', 'all'];
const DIREKTORAT_ROLE_SET = new Set(['ditbinmas', 'ditlantas', 'bidhumas', 'ditsamapta', 'ditintelkam']);

const clientTypeCache = new Map();

function toJakartaDateString(date) {
  const jsDate = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(jsDate.getTime())) {
    return null;
  }
  return jsDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function buildRangeStrings(startDate, endDate) {
  const startStr = toJakartaDateString(startDate);
  const endStr = toJakartaDateString(endDate);
  if (!startStr || !endStr) return null;
  return {
    startDate: `${startStr}T00:00:00+07:00`,
    endDate: `${endStr}T23:59:59.999+07:00`,
  };
}

function shiftJakartaDate(base, days) {
  const baseStr = toJakartaDateString(base);
  if (!baseStr) return null;
  const dateObj = new Date(`${baseStr}T00:00:00+07:00`);
  if (Number.isNaN(dateObj.getTime())) return null;
  dateObj.setDate(dateObj.getDate() + days);
  return toJakartaDateString(dateObj);
}

export function resolveTimeRange(timeRange, startDateInput, endDateInput) {
  const normalizedRange = (timeRange || '').toLowerCase() || '7d';
  const today = toJakartaDateString(new Date());
  if (!today) {
    return { error: 'Tanggal saat ini tidak valid' };
  }

  let startDateStr = today;
  let endDateStr = today;

  if (normalizedRange === 'today') {
    startDateStr = today;
    endDateStr = today;
  } else if (normalizedRange === '7d') {
    startDateStr = shiftJakartaDate(today, -6);
  } else if (normalizedRange === '30d') {
    startDateStr = shiftJakartaDate(today, -29);
  } else if (normalizedRange === '90d') {
    startDateStr = shiftJakartaDate(today, -89);
  } else if (normalizedRange === 'custom') {
    const customRange = buildRangeStrings(startDateInput, endDateInput);
    if (!customRange) {
      return { error: 'start_date dan end_date wajib diisi untuk time_range custom' };
    }
    const startTs = new Date(customRange.startDate).getTime();
    const endTs = new Date(customRange.endDate).getTime();
    if (Number.isNaN(startTs) || Number.isNaN(endTs) || startTs > endTs) {
      return { error: 'Rentang tanggal tidak valid' };
    }
    return {
      timeRange: normalizedRange,
      startDate: customRange.startDate,
      endDate: customRange.endDate,
    };
  } else if (normalizedRange === 'all') {
    const built = buildRangeStrings('2000-01-01', endDateInput || today);
    if (!built) {
      return { error: 'Rentang waktu tidak valid' };
    }
    const startTs = new Date(built.startDate).getTime();
    const endTs = new Date(built.endDate).getTime();
    if (Number.isNaN(startTs) || Number.isNaN(endTs) || startTs > endTs) {
      return { error: 'Rentang tanggal tidak valid' };
    }
    return { timeRange: normalizedRange, ...built };
  } else {
    return { error: 'time_range tidak valid' };
  }

  const builtRange = buildRangeStrings(startDateStr, endDateStr);
  if (!builtRange) {
    return { error: 'Rentang tanggal tidak valid' };
  }
  const startTs = new Date(builtRange.startDate).getTime();
  const endTs = new Date(builtRange.endDate).getTime();
  if (Number.isNaN(startTs) || Number.isNaN(endTs) || startTs > endTs) {
    return { error: 'Rentang tanggal tidak valid' };
  }
  return { timeRange: normalizedRange, ...builtRange };
}

async function getClientType(clientId) {
  if (!clientId) return null;
  const key = String(clientId).toLowerCase();
  if (clientTypeCache.has(key)) {
    return clientTypeCache.get(key);
  }
  const client = await findClientById(clientId);
  const type = client?.client_type ? client.client_type.toLowerCase() : null;
  if (type) {
    clientTypeCache.set(key, type);
  }
  return type;
}

function buildCacheKey(prefix, { clientId, startDate, endDate, role, scope, regionalId }) {
  return [
    prefix,
    clientId || 'all',
    startDate || 'start',
    endDate || 'end',
    role || 'role',
    scope || 'scope',
    regionalId || 'regional',
  ]
    .map((segment) => String(segment).trim().toLowerCase())
    .join(':');
}

function normalizeInstaUsername(username) {
  if (!username) return null;
  const trimmed = String(username).trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/instagram\.com\/(?:p\/|reel\/)?@?([A-Za-z0-9._-]+)/i);
  const candidate = fromUrl?.[1] || trimmed;
  return candidate.replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
}

function normalizeTiktokUsername(username) {
  if (!username) return null;
  const trimmed = String(username).trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/tiktok\.com\/@?([A-Za-z0-9._-]+)/i);
  const candidate = fromUrl?.[1] || trimmed;
  return candidate.replace(/^@+/, '').replace(/\/$/, '').toLowerCase();
}

function normalizeRoleValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized || null;
}

function resolveDirektoratRoleCandidate(client) {
  if (!client || typeof client !== 'object') return null;
  const parentClientId = normalizeRoleValue(client.parent_client_id);
  if (parentClientId && DIREKTORAT_ROLE_SET.has(parentClientId)) {
    return parentClientId;
  }

  const clientGroup = normalizeRoleValue(client.client_group);
  if (clientGroup) {
    const compact = clientGroup.replace(/[\s_-]+/g, '');
    for (const role of DIREKTORAT_ROLE_SET) {
      if (compact.includes(role)) return role;
    }
  }

  return null;
}

async function inferOrgDirektoratRole(clientId) {
  if (!clientId) return null;
  const client = await findClientById(clientId);
  if (!client) return null;
  if (String(client.client_type || '').trim().toLowerCase() !== 'org') return null;
  return resolveDirektoratRoleCandidate(client);
}

function shouldUseRoleFilter({ role, scope }) {
  const normalizedRole = normalizeRoleValue(role);
  if (!normalizedRole || normalizedRole === 'operator') return false;
  const normalizedScope = String(scope || '').trim().toLowerCase();
  return normalizedScope === 'direktorat' || normalizedScope === 'org' || normalizedScope === '';
}

function buildPostAudienceClause({ normalizedRole, normalizedClientId, includeClientScope }) {
  if (normalizedRole && includeClientScope && normalizedClientId) {
    return {
      sql:
        `(LOWER(TRIM(p.client_id)) = LOWER($CLIENT$) ` +
        `OR LOWER(TRIM(p.client_id)) = LOWER($ROLE$) ` +
        `OR LOWER(TRIM(pr.role_name)) = LOWER($ROLE$))`,
      needsClient: true,
      needsRole: true,
    };
  }

  if (normalizedRole) {
    return {
      sql:
        `(LOWER(TRIM(p.client_id)) = LOWER($ROLE$) ` +
        `OR LOWER(TRIM(pr.role_name)) = LOWER($ROLE$))`,
      needsClient: false,
      needsRole: true,
    };
  }

  if (normalizedClientId) {
    return {
      sql: `LOWER(TRIM(p.client_id)) = LOWER($CLIENT$)`,
      needsClient: true,
      needsRole: false,
    };
  }

  return {
    sql: '1=1',
    needsClient: false,
    needsRole: false,
  };
}

function tiktokDateBaseExpression(tableAlias = null) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `CASE
    WHEN ${prefix}source_type = 'manual_input' THEN ${prefix}created_at
    ELSE COALESCE(${prefix}original_created_at, ${prefix}created_at)
  END`;
}

function jakartaDateCast(columnAlias = 'created_at') {
  return `(( ${columnAlias} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')`;
}

function mapFromObject(obj) {
  return new Map(Object.entries(obj || {}).map(([key, value]) => [key, Number(value) || 0]));
}

function normalizeDivisionLabel(value) {
  const label = value == null ? '' : String(value).trim();
  return label || 'Tidak diketahui';
}

function buildUserDirectory(users) {
  return users.map((user) => ({
    user_id: user.user_id,
    nama: user.nama,
    pangkat: user.title || null,
    title: user.title || null,
    full_name: user.nama,
    display_name: user.nama,
    divisi: user.divisi,
    client_id: user.client_id,
    kontak_sosial: {
      instagram: user.insta || null,
      tiktok: user.tiktok || null,
    },
  }));
}

function mapEngagementPerUser(users, byUserMap, platform) {
  const normalizer = platform === 'instagram' ? normalizeInstaUsername : normalizeTiktokUsername;
  const metricKey = platform === 'instagram' ? 'likes' : 'comments';
  const totalsByUserId = new Map();
  const perUser = [];
  const seenUsernames = new Set();

  users.forEach((user) => {
    const username = normalizer(user[platform === 'instagram' ? 'insta' : 'tiktok']);
    const total = username ? byUserMap.get(username) || 0 : 0;
    if (username) {
      seenUsernames.add(username);
    }
    totalsByUserId.set(user.user_id, total);
    perUser.push({
      user_id: user.user_id,
      nama: user.nama,
      pangkat: user.title || null,
      title: user.title || null,
      full_name: user.nama,
      display_name: user.nama,
      divisi: user.divisi,
      client_id: user.client_id,
      username,
      posts: total,
      kontak_sosial: {
        instagram: user.insta || null,
        tiktok: user.tiktok || null,
      },
      [metricKey]: total,
    });
  });

  for (const [username, total] of byUserMap.entries()) {
    if (seenUsernames.has(username)) continue;
    perUser.push({
      user_id: null,
      nama: username,
      full_name: username,
      display_name: username,
      divisi: null,
      client_id: null,
      username,
      posts: total,
      [metricKey]: total,
      unmapped: true,
    });
  }

  return { perUser, totalsByUserId };
}

async function fetchInstagramLikeStats(clientId, startDate, endDate, { role, scope, regionalId }) {
  const normalizedClientId = clientId ? String(clientId).trim() : null;
  const normalizedRole = role ? String(role).trim().toLowerCase() : null;
  const normalizedScope = scope ? String(scope).trim().toLowerCase() : null;
  const normalizedRegionalId = regionalId ? String(regionalId).trim().toUpperCase() : null;

  const clientType = await getClientType(normalizedClientId);
  const useRoleFilter = shouldUseRoleFilter({ role: normalizedRole, scope: normalizedScope });
  const includeClientScope = normalizedScope === 'org' && normalizedClientId;

  const executeAggregation = async (useRoleFilter) => {
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const joins = ['JOIN insta_post p ON p.shortcode = l.shortcode'];
    const whereClauses = [];

    if (useRoleFilter) {
      joins.push('LEFT JOIN insta_post_roles pr ON pr.shortcode = p.shortcode');
      const audience = buildPostAudienceClause({
        normalizedRole,
        normalizedClientId,
        includeClientScope,
      });
      const replacements = [];
      if (audience.needsClient) {
        const clientIdx = addParam(normalizedClientId);
        replacements.push(['$CLIENT$', clientIdx]);
      }
      if (audience.needsRole) {
        const roleIdx = addParam(normalizedRole);
        replacements.push(['$ROLE$', roleIdx]);
      }
      const sql = replacements.reduce((acc, [needle, val]) => acc.replaceAll(needle, val), audience.sql);
      whereClauses.push(sql);
    } else if (normalizedClientId) {
      const clientIdx = addParam(normalizedClientId);
      whereClauses.push(`LOWER(TRIM(p.client_id)) = LOWER(${clientIdx})`);
    }

    if (normalizedRegionalId) {
      joins.push('JOIN clients c ON c.client_id = p.client_id');
      const regionalIdx = addParam(normalizedRegionalId);
      whereClauses.push(`UPPER(c.regional_id) = ${regionalIdx}`);
    }

    const startIdx = addParam(startDate);
    const endIdx = addParam(endDate);
    whereClauses.push(
      `(p.created_at AT TIME ZONE 'Asia/Jakarta') BETWEEN ${startIdx}::timestamptz AND ${endIdx}::timestamptz`
    );

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';
    const joinSql = joins.length ? ` ${joins.join(' ')}` : '';

    const { rows } = await query(
      `
      SELECT
        lower(replace(trim(COALESCE(lk.username, '')), '@', '')) AS username,
        COUNT(DISTINCT p.shortcode) AS total
      FROM insta_like l
      ${joinSql}
      JOIN LATERAL (
        SELECT COALESCE(elem->>'username', trim(both '"' FROM elem::text)) AS username
        FROM jsonb_array_elements(l.likes) AS elem
      ) AS lk ON TRUE
      WHERE ${whereSql}
      GROUP BY username
    `,
      params
    );

    const byUser = new Map();
    let totalLikes = 0;
    for (const row of rows) {
      const username = row.username ? row.username.toLowerCase() : null;
      if (!username) continue;
      const count = Number(row.total) || 0;
      totalLikes += count;
      byUser.set(username, count);
    }
    return { totalLikes, byUser };
  };

  const initial = await executeAggregation(useRoleFilter);
  if (
    initial.totalLikes === 0 &&
    useRoleFilter &&
    normalizedClientId &&
    clientType === 'direktorat'
  ) {
    return executeAggregation(false);
  }
  return initial;
}

async function fetchTiktokCommentStats(clientId, startDate, endDate, { role, scope, regionalId }) {
  const normalizedClientId = clientId ? String(clientId).trim() : null;
  const normalizedRole = role ? String(role).trim().toLowerCase() : null;
  const normalizedScope = scope ? String(scope).trim().toLowerCase() : null;
  const normalizedRegionalId = regionalId ? String(regionalId).trim().toUpperCase() : null;

  const clientType = await getClientType(normalizedClientId);
  const useRoleFilter = shouldUseRoleFilter({ role: normalizedRole, scope: normalizedScope });
  const includeClientScope = normalizedScope === 'org' && normalizedClientId;

  const executeAggregation = async (useRoleFilter) => {
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const joins = ['JOIN tiktok_post p ON p.video_id = c.video_id'];
    const whereClauses = [];

    if (useRoleFilter) {
      joins.push('LEFT JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
      const audience = buildPostAudienceClause({
        normalizedRole,
        normalizedClientId,
        includeClientScope,
      });
      const replacements = [];
      if (audience.needsClient) {
        const clientIdx = addParam(normalizedClientId);
        replacements.push(['$CLIENT$', clientIdx]);
      }
      if (audience.needsRole) {
        const roleIdx = addParam(normalizedRole);
        replacements.push(['$ROLE$', roleIdx]);
      }
      const sql = replacements.reduce((acc, [needle, val]) => acc.replaceAll(needle, val), audience.sql);
      whereClauses.push(sql);
    } else if (normalizedClientId) {
      const clientIdx = addParam(normalizedClientId);
      whereClauses.push(`LOWER(TRIM(p.client_id)) = LOWER(${clientIdx})`);
    }

    if (normalizedRegionalId) {
      joins.push('JOIN clients c2 ON c2.client_id = p.client_id');
      const regionalIdx = addParam(normalizedRegionalId);
      whereClauses.push(`UPPER(c2.regional_id) = ${regionalIdx}`);
    }

    const startIdx = addParam(startDate);
    const endIdx = addParam(endDate);
    const tiktokDateExpression = jakartaDateCast(tiktokDateBaseExpression('p'));
    whereClauses.push(
      `${tiktokDateExpression} BETWEEN ${startIdx}::timestamptz AND ${endIdx}::timestamptz`
    );

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';
    const joinSql = joins.length ? ` ${joins.join(' ')}` : '';

    const { rows } = await query(
      `
      SELECT
        lower(replace(trim(commenters.raw_username), '@', '')) AS username,
        COUNT(DISTINCT p.video_id) AS total
      FROM tiktok_comment c
      ${joinSql}
      JOIN LATERAL (
        SELECT raw_username
        FROM jsonb_array_elements_text(COALESCE(c.comments, '[]'::jsonb)) AS raw(raw_username)
      ) AS commenters ON TRUE
      WHERE ${whereSql}
      GROUP BY username
    `,
      params
    );

    const byUser = new Map();
    let totalComments = 0;
    for (const row of rows) {
      const username = row.username ? row.username.toLowerCase() : null;
      if (!username) continue;
      const count = Number(row.total) || 0;
      totalComments += count;
      byUser.set(username, count);
    }
    return { totalComments, byUser };
  };

  const initial = await executeAggregation(useRoleFilter);
  if (
    initial.totalComments === 0 &&
    useRoleFilter &&
    normalizedClientId &&
    clientType === 'direktorat'
  ) {
    return executeAggregation(false);
  }
  return initial;
}

async function getInstagramLikeStats(clientId, startDate, endDate, options) {
  const key = buildCacheKey('anev:ig_likes', { clientId, startDate, endDate, ...options });
  const cached = await redis.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return {
        totalLikes: Number(parsed.totalLikes) || 0,
        byUser: mapFromObject(parsed.byUser),
      };
    } catch {
      // ignore cache parse errors
    }
  }
  const result = await fetchInstagramLikeStats(clientId, startDate, endDate, options);
  await redis.set(
    key,
    JSON.stringify({ totalLikes: result.totalLikes, byUser: Object.fromEntries(result.byUser) }),
    { EX: TTL_SEC }
  );
  return result;
}

async function getTiktokCommentStats(clientId, startDate, endDate, options) {
  const key = buildCacheKey('anev:tt_comments', { clientId, startDate, endDate, ...options });
  const cached = await redis.get(key);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return {
        totalComments: Number(parsed.totalComments) || 0,
        byUser: mapFromObject(parsed.byUser),
      };
    } catch {
      // ignore cache parse errors
    }
  }
  const result = await fetchTiktokCommentStats(clientId, startDate, endDate, options);
  await redis.set(
    key,
    JSON.stringify({
      totalComments: result.totalComments,
      byUser: Object.fromEntries(result.byUser),
    }),
    { EX: TTL_SEC }
  );
  return result;
}

async function fetchInstagramTaskRefs(clientId, startDate, endDate, { role, scope, regionalId }) {
  const normalizedClientId = clientId ? String(clientId).trim() : null;
  const normalizedRole = role ? String(role).trim().toLowerCase() : null;
  const normalizedScope = scope ? String(scope).trim().toLowerCase() : null;
  const normalizedRegionalId = regionalId ? String(regionalId).trim().toUpperCase() : null;

  const clientType = await getClientType(normalizedClientId);
  const useRoleFilter = shouldUseRoleFilter({ role: normalizedRole, scope: normalizedScope });
  const includeClientScope = normalizedScope === 'org' && normalizedClientId;

  const executeQuery = async (useRoleClause) => {
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const joins = [];
    const whereClauses = [];

    if (useRoleClause) {
      joins.push('LEFT JOIN insta_post_roles pr ON pr.shortcode = p.shortcode');
      const audience = buildPostAudienceClause({
        normalizedRole,
        normalizedClientId,
        includeClientScope,
      });
      const replacements = [];
      if (audience.needsClient) {
        const clientIdx = addParam(normalizedClientId);
        replacements.push(['$CLIENT$', clientIdx]);
      }
      if (audience.needsRole) {
        const roleIdx = addParam(normalizedRole);
        replacements.push(['$ROLE$', roleIdx]);
      }
      const sql = replacements.reduce((acc, [needle, val]) => acc.replaceAll(needle, val), audience.sql);
      whereClauses.push(sql);
    } else if (normalizedClientId) {
      const clientIdx = addParam(normalizedClientId);
      whereClauses.push(`LOWER(TRIM(p.client_id)) = LOWER(${clientIdx})`);
    }

    if (normalizedRegionalId) {
      joins.push('JOIN clients c ON c.client_id = p.client_id');
      const regionalIdx = addParam(normalizedRegionalId);
      whereClauses.push(`UPPER(c.regional_id) = ${regionalIdx}`);
    }

    const startIdx = addParam(startDate);
    const endIdx = addParam(endDate);
    whereClauses.push(
      `(p.created_at AT TIME ZONE 'Asia/Jakarta') BETWEEN ${startIdx}::timestamptz AND ${endIdx}::timestamptz`
    );

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';
    const joinSql = joins.length ? ` ${joins.join(' ')}` : '';

    const { rows } = await query(
      `
      SELECT DISTINCT p.shortcode
      FROM insta_post p
      ${joinSql}
      WHERE ${whereSql}
      ORDER BY p.shortcode ASC
      `,
      params,
    );

    return rows
      .map((row) => String(row.shortcode || '').trim())
      .filter(Boolean)
      .map((shortcode) => ({
        task_id: shortcode,
        task_link: `https://www.instagram.com/p/${shortcode}/`,
      }));
  };

  const initial = await executeQuery(useRoleFilter);
  if (initial.length === 0 && useRoleFilter && normalizedClientId && clientType === 'direktorat') {
    return executeQuery(false);
  }
  return initial;
}

async function fetchTiktokTaskRefs(clientId, startDate, endDate, { role, scope, regionalId }) {
  const normalizedClientId = clientId ? String(clientId).trim() : null;
  const normalizedRole = role ? String(role).trim().toLowerCase() : null;
  const normalizedScope = scope ? String(scope).trim().toLowerCase() : null;
  const normalizedRegionalId = regionalId ? String(regionalId).trim().toUpperCase() : null;

  const clientType = await getClientType(normalizedClientId);
  const useRoleFilter = shouldUseRoleFilter({ role: normalizedRole, scope: normalizedScope });
  const includeClientScope = normalizedScope === 'org' && normalizedClientId;

  const executeQuery = async (useRoleClause) => {
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    const joins = [];
    const whereClauses = [];

    if (useRoleClause) {
      joins.push('LEFT JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
      const audience = buildPostAudienceClause({
        normalizedRole,
        normalizedClientId,
        includeClientScope,
      });
      const replacements = [];
      if (audience.needsClient) {
        const clientIdx = addParam(normalizedClientId);
        replacements.push(['$CLIENT$', clientIdx]);
      }
      if (audience.needsRole) {
        const roleIdx = addParam(normalizedRole);
        replacements.push(['$ROLE$', roleIdx]);
      }
      const sql = replacements.reduce((acc, [needle, val]) => acc.replaceAll(needle, val), audience.sql);
      whereClauses.push(sql);
    } else if (normalizedClientId) {
      const clientIdx = addParam(normalizedClientId);
      whereClauses.push(`LOWER(TRIM(p.client_id)) = LOWER(${clientIdx})`);
    }

    if (normalizedRegionalId) {
      joins.push('JOIN clients c2 ON c2.client_id = p.client_id');
      const regionalIdx = addParam(normalizedRegionalId);
      whereClauses.push(`UPPER(c2.regional_id) = ${regionalIdx}`);
    }

    const startIdx = addParam(startDate);
    const endIdx = addParam(endDate);
    const tiktokDateExpression = jakartaDateCast(tiktokDateBaseExpression('p'));
    whereClauses.push(
      `${tiktokDateExpression} BETWEEN ${startIdx}::timestamptz AND ${endIdx}::timestamptz`
    );

    const whereSql = whereClauses.length ? whereClauses.join(' AND ') : '1=1';
    const joinSql = joins.length ? ` ${joins.join(' ')}` : '';

    const { rows } = await query(
      `
      SELECT DISTINCT p.video_id
      FROM tiktok_post p
      ${joinSql}
      WHERE ${whereSql}
      ORDER BY p.video_id ASC
      `,
      params,
    );

    return rows
      .map((row) => String(row.video_id || '').trim())
      .filter(Boolean)
      .map((videoId) => ({
        task_id: videoId,
        task_link: `https://www.tiktok.com/@_/video/${videoId}`,
      }));
  };

  const initial = await executeQuery(useRoleFilter);
  if (initial.length === 0 && useRoleFilter && normalizedClientId && clientType === 'direktorat') {
    return executeQuery(false);
  }
  return initial;
}

export async function getAnevSummary({
  clientId,
  role,
  scope,
  regionalId,
  startDate,
  endDate,
  timeRange,
  requesterRole,
  requesterClientId,
  requesterClientIds = [],
}) {
  const directoryResult = await getUserDirectoryUsers({
    requesterRole,
    tokenClientId: requesterClientId,
    tokenClientIds: requesterClientIds,
    clientId,
    role,
    scope,
    regionalId,
  });

  let {
    users: activeUsers,
    clientId: resolvedClientId,
    role: normalizedRole,
    scope: normalizedScope,
  } = directoryResult;

  let effectiveRole = normalizedRole;
  const shouldInferDirektoratRole =
    normalizedScope === 'org' && (!normalizedRole || normalizedRole === 'operator');

  if (shouldInferDirektoratRole) {
    const inferredRole = await inferOrgDirektoratRole(resolvedClientId || clientId);
    if (inferredRole) {
      effectiveRole = inferredRole;
      const refinedDirectory = await getUserDirectoryUsers({
        requesterRole,
        tokenClientId: requesterClientId,
        tokenClientIds: requesterClientIds,
        clientId: resolvedClientId || clientId,
        role: inferredRole,
        scope: normalizedScope,
        regionalId,
      });
      if (Array.isArray(refinedDirectory.users) && refinedDirectory.users.length > 0) {
        activeUsers = refinedDirectory.users;
      }
    }
  }

  const targetClientId = resolvedClientId || clientId;
  const options = { role: effectiveRole, scope: normalizedScope, regionalId };
  const [igLikes, ttComments, igPosts, ttPosts, igTaskRefs, ttTaskRefs] = await Promise.all([
    getInstagramLikeStats(targetClientId, startDate, endDate, options),
    getTiktokCommentStats(targetClientId, startDate, endDate, options),
    getInstaPostCount(targetClientId, 'custom', null, startDate, endDate, options),
    getTiktokPostCount(targetClientId, 'custom', null, startDate, endDate, options),
    fetchInstagramTaskRefs(targetClientId, startDate, endDate, options),
    fetchTiktokTaskRefs(targetClientId, startDate, endDate, options),
  ]);

  const expectedActions = (Number(igPosts) || 0) + (Number(ttPosts) || 0);
  const userDirectory = buildUserDirectory(activeUsers);
  const { perUser: instagramPerUser, totalsByUserId: instagramTotalsByUserId } =
    mapEngagementPerUser(activeUsers, igLikes.byUser, 'instagram');
  const { perUser: tiktokPerUser, totalsByUserId: tiktokTotalsByUserId } =
    mapEngagementPerUser(activeUsers, ttComments.byUser, 'tiktok');

  const compliance = activeUsers.map((user) => {
    const likes = instagramTotalsByUserId.get(user.user_id) || 0;
    const comments = tiktokTotalsByUserId.get(user.user_id) || 0;
    const totalActions = likes + comments;
    const completionRate = expectedActions > 0 ? totalActions / expectedActions : 0;
    return {
      user_id: user.user_id,
      nama: user.nama,
      pangkat: user.title || null,
      full_name: user.nama,
      display_name: user.nama,
      divisi: user.divisi,
      client_id: user.client_id,
      assigned: expectedActions,
      instagram_posts: Number(igPosts) || 0,
      tiktok_posts: Number(ttPosts) || 0,
      expected_actions: expectedActions,
      completed: totalActions,
      likes,
      comments,
      total_actions: totalActions,
      completion_rate: Number(completionRate.toFixed(4)),
    };
  });

  const totalCompletedActions = compliance.reduce(
    (sum, entry) => sum + (Number(entry.total_actions) || 0),
    0,
  );
  const totalExpectedActions = expectedActions * activeUsers.length;
  const overallCompletionRate =
    totalExpectedActions > 0 ? totalCompletedActions / totalExpectedActions : 0;

  const userPerSatfungMap = new Map();
  const instagramLikesPerSatfungMap = new Map();
  const instagramActivePersonnelPerSatfungMap = new Map();
  const tiktokEngagementPerSatfungMap = new Map();
  const tiktokActivePersonnelPerSatfungMap = new Map();
  activeUsers.forEach((user) => {
    const divisionLabel = normalizeDivisionLabel(user.divisi);
    userPerSatfungMap.set(divisionLabel, (userPerSatfungMap.get(divisionLabel) || 0) + 1);

    const likes = instagramTotalsByUserId.get(user.user_id) || 0;
    instagramLikesPerSatfungMap.set(
      divisionLabel,
      (instagramLikesPerSatfungMap.get(divisionLabel) || 0) + likes,
    );
    if (likes > 0) {
      instagramActivePersonnelPerSatfungMap.set(
        divisionLabel,
        (instagramActivePersonnelPerSatfungMap.get(divisionLabel) || 0) + 1,
      );
    }

    const comments = tiktokTotalsByUserId.get(user.user_id) || 0;
    tiktokEngagementPerSatfungMap.set(
      divisionLabel,
      (tiktokEngagementPerSatfungMap.get(divisionLabel) || 0) + comments,
    );
    if (comments > 0) {
      tiktokActivePersonnelPerSatfungMap.set(
        divisionLabel,
        (tiktokActivePersonnelPerSatfungMap.get(divisionLabel) || 0) + 1,
      );
    }
  });

  const userPerSatfung = Array.from(userPerSatfungMap.entries()).map(([label, count]) => ({
    satfung: label,
    count,
  }));
  const assignedTasksPerSatfungMap = new Map();
  const assignedInstagramTasksPerSatfungMap = new Map();
  const totalInstagramPosts = Number(igPosts) || 0;
  const totalInstagramLikes = Number(igLikes.totalLikes) || 0;
  for (const [label, likes] of instagramLikesPerSatfungMap.entries()) {
    if (totalInstagramPosts <= 0 || totalInstagramLikes <= 0) {
      assignedInstagramTasksPerSatfungMap.set(label, 0);
      continue;
    }
    const proportionalTasks = Math.round((Number(likes) / totalInstagramLikes) * totalInstagramPosts);
    assignedInstagramTasksPerSatfungMap.set(label, proportionalTasks);
  }
  const totalTiktokPosts = Number(ttPosts) || 0;
  const totalTiktokComments = Number(ttComments.totalComments) || 0;
  for (const [label, engagement] of tiktokEngagementPerSatfungMap.entries()) {
    if (totalTiktokPosts <= 0) {
      assignedTasksPerSatfungMap.set(label, 0);
      continue;
    }
    if (totalTiktokComments <= 0) {
      assignedTasksPerSatfungMap.set(label, 0);
      continue;
    }
    const proportionalTasks = Math.round((Number(engagement) / totalTiktokComments) * totalTiktokPosts);
    assignedTasksPerSatfungMap.set(label, proportionalTasks);
  }
  const likesPerSatfung = Array.from(instagramLikesPerSatfungMap.entries()).map(
    ([label, likes]) => ({
      satfung: label,
      total_personnel: userPerSatfungMap.get(label) || 0,
      active_personnel: instagramActivePersonnelPerSatfungMap.get(label) || 0,
      posts: assignedInstagramTasksPerSatfungMap.get(label) || 0,
      task_count: assignedInstagramTasksPerSatfungMap.get(label) || 0,
      assigned: assignedInstagramTasksPerSatfungMap.get(label) || 0,
      likes,
    }),
  );
  const tiktokPerSatfung = Array.from(tiktokEngagementPerSatfungMap.entries()).map(
    ([label, engagement]) => ({
      satfung: label,
      total_personnel: userPerSatfungMap.get(label) || 0,
      active_personnel: tiktokActivePersonnelPerSatfungMap.get(label) || 0,
      posts: assignedTasksPerSatfungMap.get(label) || 0,
      task_count: assignedTasksPerSatfungMap.get(label) || 0,
      assigned: assignedTasksPerSatfungMap.get(label) || 0,
      comments: engagement,
      engagement,
    }),
  );

  return {
    filters: {
      client_id: targetClientId,
      role: effectiveRole || normalizedRole || null,
      scope: normalizedScope || null,
      regional_id: regionalId || null,
      time_range: timeRange,
      start_date: startDate,
      end_date: endDate,
      permitted_time_ranges: ALLOWED_TIME_RANGES,
    },
    user_directory: userDirectory,
    instagram_engagement: {
      total_posts: Number(igPosts) || 0,
      total_likes: igLikes.totalLikes,
      per_user: instagramPerUser,
    },
    tiktok_engagement: {
      total_posts: Number(ttPosts) || 0,
      total_comments: ttComments.totalComments,
      per_user: tiktokPerUser,
    },
    platform_tasks: {
      instagram: igTaskRefs,
      tiktok: ttTaskRefs,
    },
    aggregates: {
      totals: {
        total_users: activeUsers.length,
        likes: igLikes.totalLikes,
        comments: ttComments.totalComments,
        expected_actions: expectedActions,
        total_expected_actions: totalExpectedActions,
        total_completed_actions: totalCompletedActions,
        overall_completion_rate: Number(overallCompletionRate.toFixed(4)),
        posts: {
          instagram: Number(igPosts) || 0,
          tiktok: Number(ttPosts) || 0,
        },
        compliance_per_pelaksana: compliance,
        user_per_satfung: userPerSatfung,
        likes_per_satfung: likesPerSatfung,
        tiktok_per_satfung: tiktokPerSatfung,
      },
      platforms: [
        { platform: 'instagram', posts: Number(igPosts) || 0 },
        { platform: 'tiktok', posts: Number(ttPosts) || 0 },
      ],
      user_per_satfung: userPerSatfung,
      likes_per_satfung: likesPerSatfung,
      tiktok_per_satfung: tiktokPerSatfung,
      total_users: activeUsers.length,
      instagram_posts: Number(igPosts) || 0,
      tiktok_posts: Number(ttPosts) || 0,
      total_likes: igLikes.totalLikes,
      total_comments: ttComments.totalComments,
      expected_actions: expectedActions,
      compliance_per_pelaksana: compliance,
    },
  };
}
