import { query } from '../repository/db.js';

export async function upsertInstaPostClient(shortcode, clientId) {
  if (!shortcode || !clientId) return;
  await query(
    `INSERT INTO insta_post_clients (shortcode, client_id)
     VALUES ($1, $2)
     ON CONFLICT (shortcode, client_id) DO NOTHING`,
    [shortcode, clientId]
  );
}

export async function getShortcodesTodayByClient(clientId, dateWib) {
  if (!clientId || !dateWib) return [];

  const res = await query(
    `SELECT DISTINCT p.shortcode
     FROM insta_post p
     JOIN insta_post_clients pc ON pc.shortcode = p.shortcode
     WHERE pc.client_id = $1
       AND (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $2::date
     ORDER BY p.shortcode ASC`,
    [clientId, dateWib]
  );

  return res.rows.map((row) => row.shortcode);
}
