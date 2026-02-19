// src/handler/fetchpost/instaFetchPost.js

import pLimit from "p-limit";
import { query } from "../../db/index.js";
import { sendDebug } from "../../middleware/debugHandler.js";
import {
  fetchInstagramPostsWithQuality,
  fetchInstagramPostInfo,
} from "../../service/instagramApi.js";
import { savePostWithMedia } from "../../model/instaPostExtendedModel.js";
import { upsertInstaPost as upsertInstaPostKhusus } from "../../model/instaPostKhususModel.js";
import { extractInstagramShortcode } from "../../utils/utilsHelper.js";

const ADMIN_WHATSAPP = (process.env.ADMIN_WHATSAPP || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const limit = pLimit(6);
const IG_DELETE_GRACE_HOURS = Number(process.env.IG_DELETE_GRACE_HOURS || 24);

export function getJakartaDateString(referenceDate = new Date()) {
  return referenceDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
}

/**
 * Utility: Cek apakah unixTimestamp adalah hari ini (Asia/Jakarta)
 */
function isTodayJakarta(unixTimestamp) {
  if (!unixTimestamp) return false;
  
  // Convert Unix timestamp to Date object
  const postDate = new Date(unixTimestamp * 1000);
  
  // Get the date string in Jakarta timezone (format: YYYY-MM-DD)
  const postDateJakarta = postDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Jakarta",
  });
  
  // Get today's date string in Jakarta timezone (format: YYYY-MM-DD)
  const todayJakarta = getJakartaDateString();
  
  // Compare the date strings directly
  return postDateJakarta === todayJakarta;
}

async function getShortcodesToday(clientId = null) {
  let sql = `SELECT shortcode FROM insta_post WHERE DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $1 AND is_missing_since IS NULL`;
  const params = [getJakartaDateString()];
  if (clientId) {
    sql += ` AND client_id = $2`;
    params.push(clientId);
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

async function deleteShortcodes(
  shortcodesToDelete,
  { clientId = null, isCompleteFetch = false, graceHours = IG_DELETE_GRACE_HOURS } = {}
) {
  if (!shortcodesToDelete.length) return { quarantined: 0, hardDeleted: 0 };
  if (!isCompleteFetch) {
    sendDebug({
      tag: "IG SYNC",
      msg: `Skip deleteShortcodes karena fetch parsial/tdk lengkap. kandidat=${shortcodesToDelete.length}`,
      client_id: clientId,
    });
    return { quarantined: 0, hardDeleted: 0 };
  }

  const graceParam = `${Math.max(1, graceHours)} hours`;
  const jakartaDate = getJakartaDateString();
  const quarantineResult = await query(
    `UPDATE insta_post
     SET is_missing_since = COALESCE(is_missing_since, NOW())
     WHERE shortcode = ANY($1)
       AND ($2::text IS NULL OR client_id = $2)
       AND DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $3
       AND is_missing_since IS NULL
     RETURNING shortcode`,
    [shortcodesToDelete, clientId, jakartaDate]
  );

  const purgeTargetResult = await query(
    `SELECT shortcode
     FROM insta_post
     WHERE shortcode = ANY($1)
       AND ($2::text IS NULL OR client_id = $2)
       AND DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $3
       AND is_missing_since IS NOT NULL
       AND is_missing_since <= NOW() - $4::interval`,
    [shortcodesToDelete, clientId, jakartaDate, graceParam]
  );

  const purgeShortcodes = purgeTargetResult.rows.map((row) => row.shortcode);
  if (!purgeShortcodes.length) {
    return { quarantined: quarantineResult.rowCount || 0, hardDeleted: 0 };
  }

  // ig_ext_posts rows cascade when insta_post entries are deleted
  let sql =
    `DELETE FROM insta_post WHERE shortcode = ANY($1) AND DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $2`;
  const params = [purgeShortcodes, jakartaDate];
  if (clientId !== null) {
    sql += ` AND client_id = $3`;
    params.push(clientId);
  }
  await query(`DELETE FROM insta_like_audit WHERE shortcode = ANY($1)`, [
    purgeShortcodes,
  ]);
  await query(`DELETE FROM insta_like WHERE shortcode = ANY($1)`, [
    purgeShortcodes,
  ]);
  if (await tableExists("insta_comment")) {
    await query(`DELETE FROM insta_comment WHERE shortcode = ANY($1)`, [
      purgeShortcodes,
    ]);
  } else {
    sendDebug({
      tag: "IG FETCH",
      msg: "Skip delete from insta_comment: table not found.",
    });
  }
  await query(sql, params);
  return {
    quarantined: quarantineResult.rowCount || 0,
    hardDeleted: purgeShortcodes.length,
  };
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
    let fetchedShortcodesToday = [];
    let hasSuccessfulFetch = false;
    let isCompleteFetch = false;
    const username = client.client_insta;
    let postsRes;
    try {
      sendDebug({
        tag: "IG FETCH",
        msg: `Fetch posts for client: ${client.id} / @${username}`
      });
      const fetchResult = await limit(() =>
        fetchInstagramPostsWithQuality(username, 50)
      );
      postsRes = fetchResult.items;
      isCompleteFetch = Boolean(fetchResult.isCompleteFetch);
      sendDebug({
        tag: "IG FETCH",
        msg: `RapidAPI posts fetched: ${postsRes.length}`,
        client_id: client.id
      });
      sendDebug({
        tag: "IG FETCH QUALITY",
        msg: `isCompleteFetch=${isCompleteFetch}, pages=${fetchResult.fetchMeta?.pagesFetched || 0}, endedByLimit=${Boolean(fetchResult.fetchMeta?.endedByLimit)}`,
        client_id: client.id,
      });
    } catch (err) {
      sendDebug({
        tag: "IG POST ERROR",
        msg: err.response?.data ? JSON.stringify(err.response.data) : err.message,
        client_id: client.id
      });
      continue;
    }
    // ==== FILTER HANYA KONTEN YANG DI-POST HARI INI ====
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

      fetchedShortcodesToday.push(toSave.shortcode);

      // UPSERT ke DB: update jika sudah ada (berdasarkan shortcode)
      sendDebug({
        tag: "IG FETCH",
        msg: `[DB] Upsert IG post: ${toSave.shortcode}`,
        client_id: client.id
      });
      await query(
        `INSERT INTO insta_post (client_id, shortcode, caption, comment_count, like_count, thumbnail_url, is_video, video_url, image_url, images_url, is_carousel, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12))
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
              is_missing_since = NULL,
             created_at = to_timestamp($12)`,
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
      sendDebug({
        tag: "IG FETCH",
        msg: `[DB] Sukses upsert IG post: ${toSave.shortcode}`,
        client_id: client.id
      });

      // store extended post data
      try {
        await savePostWithMedia(post);
      } catch (err) {
        sendDebug({ tag: "IG EXT", msg: err.message });
      }
    }

    // Hapus konten hari ini yang sudah tidak ada di hasil fetch hari ini
    const shortcodesToDelete = dbShortcodesToday.filter(
      (x) => !fetchedShortcodesToday.includes(x)
    );

    sendDebug({
      tag: "IG AUDIT",
      msg: `fetched_today=${fetchedShortcodesToday.length}, existing_today=${dbShortcodesToday.length}, delete_candidates=${shortcodesToDelete.length}, complete=${isCompleteFetch}`,
      client_id: client.id,
    });

    if (isCompleteFetch) {
      sendDebug({
        tag: "IG SYNC",
        msg: `Akan menghapus shortcodes yang tidak ada hari ini: jumlah=${shortcodesToDelete.length}`,
        client_id: client.id
      });
      const deletionSummary = await deleteShortcodes(shortcodesToDelete, {
        clientId: client.id,
        isCompleteFetch,
      });
      sendDebug({
        tag: "IG SYNC",
        msg: `Quarantine=${deletionSummary.quarantined}, hardDelete=${deletionSummary.hardDeleted}`,
        client_id: client.id,
      });
    } else {
      sendDebug({
        tag: "IG SYNC",
        msg: `Fetch IG tidak eligible delete untuk client ${client.id}. hasSuccessfulFetch=${hasSuccessfulFetch}, isCompleteFetch=${isCompleteFetch}`,
        client_id: client.id
      });
    }

    // Hitung jumlah konten hari ini untuk summary
    const jakartaDate = getJakartaDateString();
      const countRes = await query(
        `SELECT shortcode FROM insta_post WHERE client_id = $1 AND DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $2`,
        [client.id, jakartaDate]
      );
    summary[client.id] = { count: countRes.rows.length };
  }

  processing = false;
  clearInterval(intervalId);

  // Ringkasan WA/console
  const jakartaDate = getJakartaDateString();

  let sumSql =
    `SELECT shortcode, created_at FROM insta_post WHERE DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $1`;
  const sumParams = [jakartaDate];
  if (targetClientId) {
    sumSql += ` AND client_id = $2`;
    sumParams.push(targetClientId);
  }
  const kontenHariIniRes = await query(sumSql, sumParams);
  const kontenLinksToday = kontenHariIniRes.rows.map(
    (r) => `https://www.instagram.com/p/${r.shortcode}`
  );

  let msg = `✅ Fetch selesai!`;
  if (targetClientId) msg += `\nClient: *${targetClientId}*`;
  msg += `\nJumlah konten hari ini: *${kontenLinksToday.length}*`;
  let maxPerMsg = 30;
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
