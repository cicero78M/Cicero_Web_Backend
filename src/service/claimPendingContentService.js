import { query } from '../repository/db.js';

const jakartaNow = "(NOW() AT TIME ZONE 'Asia/Jakarta')";

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function buildDateFilter({ periode, tanggal, startDate, endDate }, dateExpression, params) {
  if (startDate && endDate) {
    params.push(startDate, endDate);
    return `${dateExpression}::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`;
  }
  if (periode === 'semua') return 'TRUE';
  if (periode === 'mingguan') {
    if (tanggal) {
      params.push(tanggal);
      return `date_trunc('week', ${dateExpression}) = date_trunc('week', $${params.length}::date)`;
    }
    return `date_trunc('week', ${dateExpression}) = date_trunc('week', ${jakartaNow})`;
  }
  if (periode === 'bulanan') {
    if (tanggal) {
      params.push(tanggal.length === 7 ? `${tanggal}-01` : tanggal);
      return `date_trunc('month', ${dateExpression}) = date_trunc('month', $${params.length}::date)`;
    }
    return `date_trunc('month', ${dateExpression}) = date_trunc('month', ${jakartaNow})`;
  }
  if (tanggal) {
    params.push(tanggal);
    return `${dateExpression}::date = $${params.length}::date`;
  }
  return `${dateExpression}::date = ${jakartaNow}::date`;
}

async function getUserContext(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.client_id,
            COALESCE(ARRAY_AGG(DISTINCT LOWER(r.role_name))
              FILTER (WHERE r.role_name IS NOT NULL), ARRAY[]::text[]) AS roles
     FROM "user" u
     LEFT JOIN user_roles ur ON ur.user_id = u.user_id
     LEFT JOIN roles r ON r.role_id = ur.role_id
     WHERE u.user_id = $1 AND u.status = TRUE
     GROUP BY u.user_id, u.client_id`,
    [userId]
  );
  return rows[0] || null;
}

async function getSocialAccounts(userId) {
  const { rows } = await query(
    `SELECT LOWER(platform) AS platform, username
     FROM user_social_accounts
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY platform, account_order, created_at`,
    [userId]
  );
  return rows.reduce(
    (accounts, row) => {
      if (row.platform === 'instagram' || row.platform === 'tiktok') {
        const username = normalizeUsername(row.username);
        if (username && !accounts[row.platform].includes(username)) {
          accounts[row.platform].push(username);
        }
      }
      return accounts;
    },
    { instagram: [], tiktok: [] }
  );
}

function toPlatformResult(usernames, rows, idField) {
  const items = rows.map((row) => ({ ...row, completed: Boolean(row.completed) }));
  const pendingItems = items.filter((item) => !item.completed);
  return {
    username_available: usernames.length > 0,
    usernames,
    total_content: items.length,
    completed_content: items.length - pendingItems.length,
    pending_content: pendingItems.length,
    items: pendingItems.map(({ completed: _completed, ...item }) => item),
    completed_ids: items.filter((item) => item.completed).map((item) => item[idField]),
  };
}

async function getInstagramContent(context, usernames, filters) {
  if (usernames.length === 0) return toPlatformResult(usernames, [], 'shortcode');
  const params = [context.client_id, context.roles, usernames];
  const dateExpression = `(COALESCE(p.created_at, p.original_created_at) AT TIME ZONE 'Asia/Jakarta')`;
  const dateFilter = buildDateFilter(filters, dateExpression, params);
  const { rows } = await query(
    `SELECT p.shortcode,
            'https://www.instagram.com/p/' || p.shortcode AS url,
            p.caption,
            COALESCE(p.created_at, p.original_created_at) AS content_time,
            EXISTS (
              SELECT 1
              FROM insta_like il
              CROSS JOIN LATERAL jsonb_array_elements(COALESCE(il.likes, '[]'::jsonb)) elem
              WHERE il.shortcode = p.shortcode
                AND LOWER(REPLACE(TRIM(COALESCE(elem->>'username', TRIM(BOTH '"' FROM elem::text))), '@', '')) = ANY($3::text[])
            ) AS completed
     FROM insta_post p
     WHERE ${dateFilter}
       AND (
         LOWER(p.client_id) = LOWER($1)
         OR EXISTS (SELECT 1 FROM insta_post_clients pc WHERE pc.shortcode = p.shortcode AND LOWER(pc.client_id) = LOWER($1))
         OR EXISTS (SELECT 1 FROM insta_post_roles pr WHERE pr.shortcode = p.shortcode AND LOWER(pr.role_name) = ANY($2::text[]))
       )
     ORDER BY content_time DESC, p.shortcode`,
    params
  );
  return toPlatformResult(usernames, rows, 'shortcode');
}

async function getTiktokContent(context, usernames, filters) {
  if (usernames.length === 0) return toPlatformResult(usernames, [], 'video_id');
  const params = [context.client_id, context.roles, usernames];
  const dateExpression = `(CASE WHEN p.source_type = 'manual_input' THEN p.created_at ELSE COALESCE(p.original_created_at, p.created_at) END AT TIME ZONE 'Asia/Jakarta')`;
  const dateFilter = buildDateFilter(filters, dateExpression, params);
  const { rows } = await query(
    `SELECT p.video_id, NULL::text AS url, p.caption,
            CASE WHEN p.source_type = 'manual_input' THEN p.created_at ELSE COALESCE(p.original_created_at, p.created_at) END AS content_time,
            EXISTS (
              SELECT 1
              FROM tiktok_comment tc
              CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(tc.comments, '[]'::jsonb)) raw_username
              WHERE tc.video_id = p.video_id
                AND LOWER(REPLACE(TRIM(raw_username), '@', '')) = ANY($3::text[])
            ) AS completed
     FROM tiktok_post p
     WHERE ${dateFilter}
       AND (
         LOWER(p.client_id) = LOWER($1)
         OR EXISTS (SELECT 1 FROM tiktok_post_roles pr WHERE pr.video_id = p.video_id AND LOWER(pr.role_name) = ANY($2::text[]))
       )
     ORDER BY content_time DESC, p.video_id`,
    params
  );
  return toPlatformResult(usernames, rows, 'video_id');
}

export async function getPendingContentForUser(userId, filters) {
  const context = await getUserContext(userId);
  if (!context) return null;
  const accounts = await getSocialAccounts(userId);
  const [instagram, tiktok] = await Promise.all([
    getInstagramContent(context, accounts.instagram, filters),
    getTiktokContent(context, accounts.tiktok, filters),
  ]);
  return {
    user_id: context.user_id,
    timezone: 'Asia/Jakarta',
    filters: {
      periode: filters.periode,
      tanggal: filters.tanggal || null,
      start_date: filters.startDate || null,
      end_date: filters.endDate || null,
    },
    instagram,
    tiktok,
  };
}

export async function getComplaintContentForUser(
  userId,
  platform,
  contentId,
  filters
) {
  const pendingContent = await getPendingContentForUser(userId, filters);
  if (!pendingContent) return null;
  const platformContent = pendingContent[platform];
  const idField = platform === 'instagram' ? 'shortcode' : 'video_id';
  const item = platformContent?.items.find(
    (content) => String(content[idField]) === String(contentId)
  );
  return item ? { item, usernames: platformContent.usernames } : false;
}
