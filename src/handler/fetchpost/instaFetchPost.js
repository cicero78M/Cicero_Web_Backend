// src/handler/fetchpost/instaFetchPost.js

import pLimit from "p-limit";
import { query } from "../../db/index.js";
import { sendDebug } from "../../middleware/debugHandler.js";
import { fetchInstagramPosts, fetchInstagramPostInfo } from "../../service/instagramApi.js";
import { savePostWithMedia } from "../../model/instaPostExtendedModel.js";
import { upsertInstaPost as upsertInstaPostKhusus } from "../../model/instaPostKhususModel.js";
import { extractInstagramShortcode } from "../../utils/utilsHelper.js";

const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const limit = pLimit(6);
const MAX_FETCH_LIMIT = 50;

function getTodayWibDateString() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Utility: Cek apakah unixTimestamp adalah hari ini (Asia/Jakarta)
 */
function isTodayJakarta(unixTimestamp) {
  if (!unixTimestamp) return false;
  const postDate = new Date(unixTimestamp * 1000);
  const postDateJakarta = postDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
  const todayJakarta = getTodayWibDateString();
  return postDateJakarta === todayJakarta;
}

async function getShortcodesToday(clientId = null) {
  const todayWib = getTodayWibDateString();
  const params = [todayWib];
  let sql = `
    SELECT DISTINCT p.shortcode
    FROM insta_post p
    LEFT JOIN insta_post_clients pc ON pc.shortcode = p.shortcode
    WHERE (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $1::date
  `;

  if (clientId) {
    params.push(clientId);
    sql += ` AND pc.client_id = $2`;
  }

  const res = await query(sql, params);
  return res.rows.map((r) => r.shortcode);
}

async function tableExists(tableName) {
  const res = await query(`SELECT to_regclass($1) AS table_name`, [
    `public.${tableName}`,
  ]);
  return Boolean(res.rows[0]?.table_name);
}

function shouldSkipDeleteGuard({ dbCount, fetchedCount, deleteCount, rawCount }) {
  if (!deleteCount) return { skip: true, reason: "Tidak ada kandidat delete" };

  const maxDeletePerClient = Number.parseInt(
    process.env.IG_SAFE_DELETE_MAX_PER_CLIENT || "10",
    10
  );
  if (Number.isFinite(maxDeletePerClient) && deleteCount > maxDeletePerClient) {
    return {
      skip: true,
      reason: `Kandidat delete ${deleteCount} melebihi threshold client ${maxDeletePerClient}`,
    };
  }

  if (dbCount > 0 && fetchedCount === 0) {
    return {
      skip: true,
      reason: "Indikasi partial response: hasil fetch hari ini kosong",
    };
  }

  if (rawCount >= MAX_FETCH_LIMIT) {
    return {
      skip: true,
      reason: "Indikasi partial response: response menyentuh batas limit fetch",
    };
  }

  const drasticDropRatio = Number.parseFloat(
    process.env.IG_SAFE_DELETE_DRASTIC_DROP_RATIO || "0.5"
  );
  const minimumBaseline = Number.parseInt(
    process.env.IG_SAFE_DELETE_MIN_BASELINE || "5",
    10
  );
  const dropRatio = dbCount > 0 ? deleteCount / dbCount : 0;

  if (
    Number.isFinite(drasticDropRatio) &&
    dbCount >= minimumBaseline &&
    dropRatio >= drasticDropRatio
  ) {
    return {
      skip: true,
      reason: `Indikasi drastic drop ${(dropRatio * 100).toFixed(2)}% dari baseline ${dbCount}`,
    };
  }

  return { skip: false, reason: null };
}

async function deleteShortcodes(shortcodesToDelete, clientId = null) {
  if (!shortcodesToDelete.length || !clientId) return;

  const todayWib = getTodayWibDateString();

  await query(
    `DELETE FROM insta_post_clients pc
     USING insta_post p
     WHERE pc.shortcode = p.shortcode
       AND pc.client_id = $1
       AND pc.shortcode = ANY($2)
       AND p.source_type = 'cron_fetch'
       AND (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $3::date`,
    [clientId, shortcodesToDelete, todayWib]
  );

  const deletableRes = await query(
    `SELECT p.shortcode
     FROM insta_post p
     WHERE p.shortcode = ANY($1)
       AND p.source_type = 'cron_fetch'
       AND (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $2::date
       AND NOT EXISTS (
         SELECT 1 FROM insta_post_clients pc WHERE pc.shortcode = p.shortcode
       )`,
    [shortcodesToDelete, todayWib]
  );

  const deletableShortcodes = deletableRes.rows.map((row) => row.shortcode);
  if (!deletableShortcodes.length) return;

  await query(`DELETE FROM insta_like_audit WHERE shortcode = ANY($1)`, [
    deletableShortcodes,
  ]);
  await query(`DELETE FROM insta_like WHERE shortcode = ANY($1)`, [
    deletableShortcodes,
  ]);
  if (await tableExists("insta_comment")) {
    await query(`DELETE FROM insta_comment WHERE shortcode = ANY($1)`, [
      deletableShortcodes,
    ]);
  } else {
    sendDebug({
      tag: "IG FETCH",
      msg: "Skip delete from insta_comment: table not found.",
    });
  }

  await query(`DELETE FROM insta_post WHERE shortcode = ANY($1)`, [
    deletableShortcodes,
  ]);
}

async function getEligibleClients() {
  const res = await query(
    `SELECT client_id as id, client_insta FROM clients
      WHERE client_status=true
        AND (client_insta_status=true OR client_amplify_status=true)
        AND client_insta IS NOT NULL`
  );
  return res.rows;
}

/**
 * Fungsi utama: fetch & simpan post hari ini SAJA (update jika sudah ada)
 */
export async function fetchAndStoreInstaContent(
  keys,
  waClient = null,
  chatId = null,
  targetClientId = null
) {
  let processing = true;
  if (!waClient)
    sendDebug({ tag: "IG FETCH", msg: "fetchAndStoreInstaContent: mode cronjob/auto" });
  else
    sendDebug({ tag: "IG FETCH", msg: "fetchAndStoreInstaContent: mode WA handler" });

  const intervalId = setInterval(() => {
    if (
      processing &&
      waClient &&
      chatId &&
      typeof waClient.sendMessage === "function"
    ) {
      waClient.sendMessage(chatId, "⏳ Processing fetch data...");
    }
  }, 4000);

  const clients = await getEligibleClients();
  const clientsToFetch = targetClientId
    ? clients.filter((c) => c.id === targetClientId)
    : clients;

  if (targetClientId && clientsToFetch.length === 0) {
    processing = false;
    clearInterval(intervalId);
    throw new Error(`Client ID ${targetClientId} tidak ditemukan atau tidak aktif`);
  }

  const summary = {};

  sendDebug({
    tag: "IG FETCH",
    msg: `Eligible clients for Instagram fetch: jumlah client: ${clientsToFetch.length}`
  });

  for (const client of clientsToFetch) {
    const dbShortcodesToday = await getShortcodesToday(client.id);
    const fetchedShortcodesToday = new Set();
    let hasSuccessfulFetch = false;
    const username = client.client_insta;
    let postsRes;
    try {
      sendDebug({
        tag: "IG FETCH",
        msg: `Fetch posts for client: ${client.id} / @${username}`
      });
      postsRes = await limit(() => fetchInstagramPosts(username, MAX_FETCH_LIMIT));
      sendDebug({
        tag: "IG FETCH",
        msg: `RapidAPI posts fetched: ${postsRes.length}`,
        client_id: client.id
      });
    } catch (err) {
      sendDebug({
        tag: "IG POST ERROR",
        msg: err.response?.data ? JSON.stringify(err.response.data) : err.message,
        client_id: client.id
      });
      continue;
    }

    const items = Array.isArray(postsRes)
      ? postsRes.filter((post) => isTodayJakarta(post.taken_at))
      : [];

    sendDebug({
      tag: "IG FETCH",
      msg: `Jumlah post IG HARI INI SAJA: ${items.length}`,
      client_id: client.id
    });

    if (items.length > 0) hasSuccessfulFetch = true;

    for (const post of items) {
      const toSave = {
        client_id: client.id,
        shortcode: post.code,
        comment_count:
          typeof post.comment_count === "number" ? post.comment_count : 0,
        like_count: typeof post.like_count === "number" ? post.like_count : 0,
        thumbnail_url:
          post.thumbnail_url ||
          post.thumbnail_src ||
          post.display_url ||
          (post.image_versions?.items?.[0]?.url) || null,
        is_video: post.is_video || false,
        video_url: post.video_url || (post.video_versions?.[0]?.url) || null,
        image_url: post.image_versions?.items?.[0]?.url || null,
        images_url: (() => {
          const arr = (post.carousel_media || [])
            .map((m) => m.image_versions?.items?.[0]?.url)
            .filter(Boolean);
          if (!arr.length && post.image_versions?.items?.[0]?.url) {
            arr.push(post.image_versions.items[0].url);
          }
          return arr.length ? arr : null;
        })(),
        is_carousel:
          Array.isArray(post.carousel_media) && post.carousel_media.length > 1,
        caption:
          post.caption && typeof post.caption === "object" && post.caption.text
            ? post.caption.text
            : typeof post.caption === "string"
            ? post.caption
            : null,
      };

      fetchedShortcodesToday.add(toSave.shortcode);

      sendDebug({
        tag: "IG FETCH",
        msg: `[DB] Upsert IG post: ${toSave.shortcode}`,
        client_id: client.id
      });

      await query(
        `INSERT INTO insta_post (
           client_id, shortcode, caption, comment_count, like_count, thumbnail_url,
           is_video, video_url, image_url, images_url, is_carousel,
           source_type, original_created_at, created_at
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,
           'cron_fetch',to_timestamp($12),NOW()
         )
         ON CONFLICT (shortcode) DO UPDATE
         SET client_id = EXCLUDED.client_id,
             caption = EXCLUDED.caption,
             comment_count = EXCLUDED.comment_count,
             like_count = EXCLUDED.like_count,
             thumbnail_url = EXCLUDED.thumbnail_url,
             is_video = EXCLUDED.is_video,
             video_url = EXCLUDED.video_url,
             image_url = EXCLUDED.image_url,
             images_url = EXCLUDED.images_url,
             is_carousel = EXCLUDED.is_carousel,
             source_type = CASE
               WHEN insta_post.source_type = 'manual_input' THEN insta_post.source_type
               ELSE EXCLUDED.source_type
             END,
             original_created_at = COALESCE(insta_post.original_created_at, EXCLUDED.original_created_at),
             created_at = CASE
               WHEN insta_post.source_type = 'manual_input' THEN insta_post.created_at
               ELSE NOW()
             END`,
        [
          toSave.client_id,
          toSave.shortcode,
          toSave.caption || null,
          toSave.comment_count,
          toSave.like_count,
          toSave.thumbnail_url,
          toSave.is_video,
          toSave.video_url,
          toSave.image_url,
          JSON.stringify(toSave.images_url),
          toSave.is_carousel,
          post.taken_at,
        ]
      );

      await query(
        `INSERT INTO insta_post_clients (shortcode, client_id)
         VALUES ($1, $2)
         ON CONFLICT (shortcode, client_id) DO NOTHING`,
        [toSave.shortcode, client.id]
      );

      sendDebug({
        tag: "IG FETCH",
        msg: `[DB] Sukses upsert IG post: ${toSave.shortcode}`,
        client_id: client.id
      });

      try {
        await savePostWithMedia(post);
      } catch (err) {
        sendDebug({ tag: "IG EXT", msg: err.message });
      }
    }

    const shortcodesToDelete = dbShortcodesToday.filter(
      (x) => !fetchedShortcodesToday.has(x)
    );

    if (hasSuccessfulFetch) {
      const safeDelete = shouldSkipDeleteGuard({
        dbCount: dbShortcodesToday.length,
        fetchedCount: fetchedShortcodesToday.size,
        deleteCount: shortcodesToDelete.length,
        rawCount: Array.isArray(postsRes) ? postsRes.length : 0,
      });

      if (safeDelete.skip) {
        sendDebug({
          tag: "IG SYNC",
          msg: `Safe-delete skip untuk client ${client.id}: ${safeDelete.reason}`,
          client_id: client.id,
        });
      } else {
        sendDebug({
          tag: "IG SYNC",
          msg: `Akan menghapus shortcodes yang tidak ada hari ini: jumlah=${shortcodesToDelete.length}`,
          client_id: client.id
        });
        await deleteShortcodes(shortcodesToDelete, client.id);
      }
    } else {
      sendDebug({
        tag: "IG SYNC",
        msg: `Tidak ada fetch IG berhasil untuk client ${client.id}, database tidak dihapus`,
        client_id: client.id
      });
    }

    const countRes = await query(
      `SELECT COUNT(DISTINCT p.shortcode) AS total
       FROM insta_post p
       JOIN insta_post_clients pc ON pc.shortcode = p.shortcode
       WHERE pc.client_id = $1
         AND (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $2::date`,
      [client.id, getTodayWibDateString()]
    );
    summary[client.id] = { count: Number(countRes.rows[0]?.total || 0) };
  }

  processing = false;
  clearInterval(intervalId);

  const todayWib = getTodayWibDateString();

  let sumSql =
    `SELECT DISTINCT p.shortcode
     FROM insta_post p
     LEFT JOIN insta_post_clients pc ON pc.shortcode = p.shortcode
     WHERE (COALESCE(p.original_created_at, p.created_at) AT TIME ZONE 'Asia/Jakarta')::date = $1::date`;
  const sumParams = [todayWib];
  if (targetClientId) {
    sumSql += ` AND pc.client_id = $2`;
    sumParams.push(targetClientId);
  }

  const kontenHariIniRes = await query(sumSql, sumParams);
  const kontenLinksToday = kontenHariIniRes.rows.map(
    (r) => `https://www.instagram.com/p/${r.shortcode}`
  );

  let msg = `✅ Fetch selesai!`;
  if (targetClientId) msg += `\nClient: *${targetClientId}*`;
  msg += `\nJumlah konten hari ini: *${kontenLinksToday.length}*`;
  const maxPerMsg = 30;
  const totalMsg = Math.ceil(kontenLinksToday.length / maxPerMsg);

  if (waClient && (chatId || ADMIN_WHATSAPP.length)) {
    const sendTargets = chatId ? [chatId] : ADMIN_WHATSAPP;
    for (const target of sendTargets) {
      await waClient.sendMessage(target, msg);
      for (let i = 0; i < totalMsg; i++) {
        const linksMsg = kontenLinksToday
          .slice(i * maxPerMsg, (i + 1) * maxPerMsg)
          .join("\n");
        await waClient.sendMessage(
          target,
          `Link konten Instagram:\n${linksMsg}`
        );
      }
    }
  } else {
    sendDebug({
      tag: "IG FETCH",
      msg: msg
    });
    if (kontenLinksToday.length) {
      sendDebug({
        tag: "IG FETCH",
        msg: kontenLinksToday.join("\n")
      });
    }
  }
  return summary;
}

export async function fetchSinglePostKhusus(linkOrCode, clientId) {
  const code = extractInstagramShortcode(linkOrCode);
  if (!code) throw new Error('invalid link');
  const info = await fetchInstagramPostInfo(code);
  if (!info) throw new Error('post not found');
  const data = {
    client_id: clientId,
    shortcode: code,
    caption: info.caption?.text || info.caption || null,
    comment_count: info.comment_count || 0,
    thumbnail_url:
      info.thumbnail_url ||
      info.display_url ||
      info.image_versions?.items?.[0]?.url || null,
    is_video: info.is_video || false,
    video_url: info.video_url || null,
    image_url: info.image_versions?.items?.[0]?.url || null,
    images_url: Array.isArray(info.carousel_media)
      ? info.carousel_media.map(i => i.image_versions?.items?.[0]?.url).filter(Boolean)
      : null,
    is_carousel: Array.isArray(info.carousel_media) && info.carousel_media.length > 1,
    created_at: info.taken_at ? new Date(info.taken_at * 1000).toISOString() : null
  };
  await upsertInstaPostKhusus(data);
  try {
    await savePostWithMedia(info);
  } catch (e) {
    sendDebug({ tag: 'IG FETCH', msg: `ext save error ${e.message}` });
  }
  return data;
}
