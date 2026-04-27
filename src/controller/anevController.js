import XLSX from "xlsx";
import { sendConsoleDebug } from "../middleware/debugHandler.js";
import { ALLOWED_TIME_RANGES, getAnevSummary, resolveTimeRange } from "../service/anevService.js";
import { UserDirectoryError } from "../service/userDirectoryService.js";

function normalizeClientIdList(clientIds) {
  if (!Array.isArray(clientIds)) return [];
  return clientIds
    .filter((id) => id != null && String(id).trim() !== "")
    .map((id) => String(id).trim());
}

async function resolveAnevContext(req) {
  const timeRangeInput = req.query.time_range || req.query.timeRange || "7d";
  const { startDate, endDate, timeRange, error } = resolveTimeRange(
    timeRangeInput,
    req.query.start_date || req.query.startDate,
    req.query.end_date || req.query.endDate,
  );
  if (error) {
    return {
      error: {
        status: 400,
        payload: { success: false, message: error, permitted_time_ranges: ALLOWED_TIME_RANGES },
      },
    };
  }

  const allowedClientIds = normalizeClientIdList(req.dashboardUser?.client_ids);
  const dashboardRole = (req.dashboardUser?.role || "").toLowerCase();
  const requestedClientId = req.query.client_id || req.headers["x-client-id"];
  const normalizedRequestedClientId = requestedClientId
    ? String(requestedClientId).trim()
    : null;
  let clientId = null;

  if (normalizedRequestedClientId) {
    const normalizedRequested = normalizedRequestedClientId.toLowerCase();
    if (allowedClientIds.length > 0) {
      const matchIndex = allowedClientIds.findIndex(
        (id) => String(id).toLowerCase() === normalizedRequested,
      );
      if (matchIndex === -1) {
        return {
          error: {
            status: 403,
            payload: { success: false, message: "client_id tidak diizinkan" },
          },
        };
      }
      clientId = allowedClientIds[matchIndex];
    } else if (
      req.dashboardUser?.client_id &&
      String(req.dashboardUser.client_id).toLowerCase() === normalizedRequested
    ) {
      clientId = req.dashboardUser.client_id;
    } else {
      clientId = normalizedRequestedClientId;
    }
  } else if (dashboardRole === "operator") {
    if (allowedClientIds.length === 1) {
      [clientId] = allowedClientIds;
    } else if (allowedClientIds.length === 0 && req.dashboardUser?.client_id) {
      clientId = req.dashboardUser.client_id;
    } else {
      return {
        error: {
          status: 400,
          payload: { success: false, message: "client_id wajib diisi" },
        },
      };
    }
  } else if (req.dashboardUser?.client_id) {
    clientId = req.dashboardUser.client_id;
  } else if (allowedClientIds.length === 1) {
    [clientId] = allowedClientIds;
  } else if (allowedClientIds.length > 0 && dashboardRole !== "operator") {
    [clientId] = allowedClientIds;
  }

  if (!clientId) {
    return {
      error: {
        status: 400,
        payload: { success: false, message: "client_id wajib diisi" },
      },
    };
  }

  const resolvedRole = (req.query.role || req.dashboardUser?.role || "").toLowerCase() || null;
  const resolvedScope = (req.query.scope || req.dashboardUser?.scope || "org").toLowerCase();
  if (!["org", "direktorat"].includes(resolvedScope)) {
    return {
      error: {
        status: 400,
        payload: { success: false, message: "scope tidak valid" },
      },
    };
  }
  if (!resolvedRole) {
    return {
      error: {
        status: 400,
        payload: { success: false, message: "role wajib diisi" },
      },
    };
  }

  const regionalId = req.query.regional_id
    ? String(req.query.regional_id).trim().toUpperCase()
    : null;

  return {
    context: {
      clientId,
      role: resolvedRole,
      scope: resolvedScope,
      regionalId,
      startDate,
      endDate,
      timeRange,
      dashboardRole,
      allowedClientIds,
      requesterClientId: req.dashboardUser?.client_id,
    },
  };
}

async function fetchAnevSummary(req) {
  const { error, context } = await resolveAnevContext(req);
  if (error) return { error };

  const summary = await getAnevSummary({
    clientId: context.clientId,
    role: context.role,
    scope: context.scope,
    regionalId: context.regionalId,
    startDate: context.startDate,
    endDate: context.endDate,
    timeRange: context.timeRange,
    requesterRole: context.dashboardRole,
    requesterClientId: context.requesterClientId,
    requesterClientIds: context.allowedClientIds,
  });

  return { summary };
}

function normalizeHandle(value) {
  if (!value) return "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}

function mapTopPerformerRows(summary, context) {
  const directory = Array.isArray(summary?.user_directory) ? summary.user_directory : [];
  const targetClientId = String(context?.client_id || "").trim().toLowerCase();
  const byId = new Map();
  const byHandle = new Map();
  directory.forEach((entry) => {
    const entryClientId = String(entry?.client_id || "").trim().toLowerCase();
    if (targetClientId && entryClientId && entryClientId !== targetClientId) {
      return;
    }

    const userId = entry?.user_id ? String(entry.user_id).trim() : "";
    const nama = String(entry?.display_name || entry?.full_name || entry?.nama || "").trim();
    const pangkat = String(entry?.pangkat || entry?.title || "").trim();
    const satfung = String(entry?.divisi || entry?.division || entry?.satfung || "-").trim() || "-";
    const identity = { nama, pangkat, satfung, client_id: entryClientId || null };
    if (userId) byId.set(userId, identity);

    const handles = [
      entry?.username,
      entry?.instagram,
      entry?.tiktok,
      entry?.insta,
      entry?.tiktok_username,
      entry?.instagram_username,
      entry?.kontak_sosial?.instagram,
      entry?.kontak_sosial?.tiktok,
    ]
      .map((value) => normalizeHandle(value))
      .filter(Boolean);
    handles.forEach((handle) => byHandle.set(handle, identity));
  });

  const igRows = Array.isArray(summary?.instagram_engagement?.per_user)
    ? summary.instagram_engagement.per_user
    : [];
  const tkRows = Array.isArray(summary?.tiktok_engagement?.per_user)
    ? summary.tiktok_engagement.per_user
    : [];
  const merged = new Map();

  const upsert = (entry, metric) => {
    const entryClientId = String(entry?.client_id || "").trim().toLowerCase();
    if (targetClientId && entryClientId && entryClientId !== targetClientId) {
      return;
    }

    const userId = entry?.user_id ? String(entry.user_id).trim() : "";
    const username = normalizeHandle(entry?.username);
    const identity = (userId && byId.get(userId)) || (username && byHandle.get(username));

    if (targetClientId) {
      if (!identity && !entryClientId) return;
      const resolvedClientId = String(identity?.client_id || entryClientId || "").trim().toLowerCase();
      if (resolvedClientId && resolvedClientId !== targetClientId) return;
    }

    const key = userId || username || normalizeHandle(entry?.nama || entry?.display_name);
    if (!key) return;

    const baseName =
      (identity?.nama || entry?.display_name || entry?.full_name || entry?.nama || entry?.name || username || "User");
    const pangkat = String(identity?.pangkat || entry?.pangkat || entry?.title || "").trim();
    const personel = [pangkat, baseName].filter(Boolean).join(" ").trim() || baseName;
    const satfung =
      String(identity?.satfung || entry?.divisi || entry?.division || entry?.satfung || "-").trim() || "-";
    const value = Number(metric === "likes" ? entry?.likes : entry?.comments) || 0;

    if (!merged.has(key)) {
      merged.set(key, {
        personel,
        username: username ? `@${username}` : "",
        satfung,
        likes_ig: 0,
        komentar_tiktok: 0,
      });
    }

    const current = merged.get(key);
    if (metric === "likes") current.likes_ig += value;
    if (metric === "comments") current.komentar_tiktok += value;
    if ((!current.satfung || current.satfung === "-") && satfung) current.satfung = satfung;
    if ((!current.personel || current.personel === current.username) && personel) current.personel = personel;
  };

  igRows.forEach((entry) => upsert(entry, "likes"));
  tkRows.forEach((entry) => upsert(entry, "comments"));

  return Array.from(merged.values())
    .map((row) => ({
      section: "top_performer",
      ...row,
      total_interaksi: Number(row.likes_ig || 0) + Number(row.komentar_tiktok || 0),
      ...context,
    }))
    .sort((a, b) => Number(b.total_interaksi || 0) - Number(a.total_interaksi || 0));
}

function buildExportRows(summary, selectedSection = null) {
  const filters = summary?.filters || {};
  const context = {
    time_range: filters.time_range || "",
    start_date: filters.start_date || "",
    end_date: filters.end_date || "",
    role: filters.role || "",
    scope: filters.scope || "",
    client_id: filters.client_id || "",
  };

  const aggregates = summary?.aggregates || {};
  const totals = aggregates?.totals || {};
  const rows = [];

  rows.push(
    {
      section: "ringkasan",
      metric: "total_users",
      value: Number(totals.total_users ?? aggregates.total_users ?? 0),
      ...context,
    },
    {
      section: "ringkasan",
      metric: "total_likes",
      value: Number(totals.likes ?? aggregates.total_likes ?? 0),
      ...context,
    },
    {
      section: "ringkasan",
      metric: "total_comments",
      value: Number(totals.comments ?? aggregates.total_comments ?? 0),
      ...context,
    },
    {
      section: "ringkasan",
      metric: "expected_actions",
      value: Number(totals.expected_actions ?? aggregates.expected_actions ?? 0),
      ...context,
    },
  );

  const platforms = Array.isArray(aggregates.platforms) ? aggregates.platforms : [];
  const platformTasks = summary?.platform_tasks || {};
  platforms.forEach((entry) => {
    const platform = String(entry?.platform || "").toLowerCase();
    const tasks = Array.isArray(platformTasks?.[platform]) ? platformTasks[platform] : [];
    if (!tasks.length) {
      rows.push({
        section: "posting_per_platform",
        platform,
        task_id: "",
        task_link: "",
        ...context,
      });
      return;
    }
    tasks.forEach((task) => {
      rows.push({
        section: "posting_per_platform",
        platform,
        task_id: task?.task_id || "",
        task_link: task?.task_link || "",
        ...context,
      });
    });
  });

  const complianceRows =
    (Array.isArray(totals.compliance_per_pelaksana) && totals.compliance_per_pelaksana) ||
    (Array.isArray(aggregates.compliance_per_pelaksana) && aggregates.compliance_per_pelaksana) ||
    [];
  complianceRows.forEach((entry) => {
    const nama = entry?.nama || entry?.name || entry?.pelaksana || "-";
    const pangkat = entry?.pangkat || entry?.title || "";
    rows.push({
      section: "compliance_per_pelaksana",
      pelaksana: [pangkat, nama].filter(Boolean).join(" "),
      jumlah_post_ig: Number(entry?.instagram_posts || 0),
      jumlah_post_tiktok: Number(entry?.tiktok_posts || 0),
      pelaksanaan_likes_ig: Number(entry?.likes || 0),
      pelaksanaan_komentar_tiktok: Number(entry?.comments || 0),
      total_tugas: Number(entry?.assigned || entry?.expected_actions || 0),
      completed: Number(entry?.completed || 0),
      completion_rate: Number(entry?.completion_rate || 0),
      ...context,
    });
  });

  const satfungRows =
    (Array.isArray(aggregates.user_per_satfung) && aggregates.user_per_satfung) ||
    (Array.isArray(totals.user_per_satfung) && totals.user_per_satfung) ||
    [];
  satfungRows.forEach((entry) => {
    rows.push({
      section: "user_per_satfung_divisi",
      satfung_divisi: entry?.satfung || entry?.division || entry?.label || "-",
      users: Number(entry?.count || 0),
      ...context,
    });
  });

  const tiktokRows =
    (Array.isArray(aggregates.tiktok_per_satfung) && aggregates.tiktok_per_satfung) ||
    (Array.isArray(totals.tiktok_per_satfung) && totals.tiktok_per_satfung) ||
    [];
  tiktokRows.forEach((entry) => {
    rows.push({
      section: "tiktok_per_satfung_divisi",
      satfung_divisi: entry?.satfung || entry?.division || entry?.label || "-",
      jumlah_personil_satfung: Number(entry?.total_personnel || 0),
      jumlah_personil_melaksanakan_komentar: Number(entry?.active_personnel || 0),
      jumlah_post_tugas_tiktok: Number(entry?.task_count || entry?.assigned || entry?.posts || 0),
      total_komentar: Number(entry?.comments || 0),
      ...context,
    });
  });

  const igLikesRows =
    (Array.isArray(aggregates.likes_per_satfung) && aggregates.likes_per_satfung) ||
    (Array.isArray(totals.likes_per_satfung) && totals.likes_per_satfung) ||
    [];
  igLikesRows.forEach((entry) => {
    rows.push({
      section: "instagram_likes_per_satfung_divisi",
      satfung_divisi: entry?.satfung || entry?.division || entry?.label || "-",
      jumlah_personil_satfung: Number(entry?.total_personnel || 0),
      jumlah_personil_melaksanakan_likes: Number(entry?.active_personnel || 0),
      jumlah_post_tugas_instagram: Number(entry?.task_count || entry?.assigned || entry?.posts || 0),
      total_likes: Number(entry?.likes || 0),
      ...context,
    });
  });

  rows.push(...mapTopPerformerRows(summary, context));

  if (!selectedSection) {
    return rows;
  }

  const normalized = String(selectedSection).trim().toLowerCase();
  const aliases = {
    ringkasan: ["ringkasan"],
    platform_posts: ["posting_per_platform"],
    compliance: ["compliance_per_pelaksana"],
    user_satfung: ["user_per_satfung_divisi"],
    ig_satfung: ["instagram_likes_per_satfung_divisi"],
    tiktok_satfung: ["tiktok_per_satfung_divisi"],
    top_performer: ["top_performer"],
  };
  const allowed = aliases[normalized] || [normalized];
  return rows.filter((row) => allowed.includes(String(row.section || "").toLowerCase()));
}

function computeWorksheetColumnWidths(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const headers = Object.keys(rows[0] || {});
  return headers.map((header) => {
    const maxCellLength = rows.reduce((max, row) => {
      const value = row?.[header];
      const text = value == null ? "" : String(value);
      return Math.max(max, text.length);
    }, header.length);
    return { wch: Math.min(Math.max(maxCellLength + 2, header.length + 2), 120) };
  });
}

function toSheetName(section, index) {
  const fallback = `Sheet${index}`;
  const raw = String(section || fallback).trim() || fallback;
  return raw.replace(/[\\/?*[\]:]/g, "-").replace(/\s+/g, "_").slice(0, 31);
}

const SECTION_COLUMN_ORDER = {
  ringkasan: [
    "metric",
    "value",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  posting_per_platform: [
    "platform",
    "task_id",
    "task_link",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  compliance_per_pelaksana: [
    "pelaksana",
    "jumlah_post_ig",
    "jumlah_post_tiktok",
    "pelaksanaan_likes_ig",
    "pelaksanaan_komentar_tiktok",
    "total_tugas",
    "completed",
    "completion_rate",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  user_per_satfung_divisi: [
    "satfung_divisi",
    "users",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  instagram_likes_per_satfung_divisi: [
    "satfung_divisi",
    "jumlah_personil_satfung",
    "jumlah_personil_melaksanakan_likes",
    "jumlah_post_tugas_instagram",
    "total_likes",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  tiktok_per_satfung_divisi: [
    "satfung_divisi",
    "jumlah_personil_satfung",
    "jumlah_personil_melaksanakan_komentar",
    "jumlah_post_tugas_tiktok",
    "total_komentar",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
  top_performer: [
    "personel",
    "satfung",
    "username",
    "likes_ig",
    "komentar_tiktok",
    "total_interaksi",
    "time_range",
    "start_date",
    "end_date",
    "role",
    "scope",
    "client_id",
  ],
};

function reorderRowBySection(section, row) {
  const preferredOrder = SECTION_COLUMN_ORDER[String(section || "").toLowerCase()] || [];
  const ordered = {};
  preferredOrder.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      ordered[key] = row[key];
    }
  });

  Object.keys(row).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = row[key];
    }
  });

  return ordered;
}

function buildWorkbookBuffer(rows) {
  const workbook = XLSX.utils.book_new();
  const grouped = new Map();
  rows.forEach((row) => {
    const key = row.section || "ringkasan";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  let index = 1;
  for (const [section, sectionRows] of grouped.entries()) {
    const normalizedRows = sectionRows.map((row) => {
      const clone = { ...row };
      delete clone.section;
      return reorderRowBySection(section, clone);
    });
    const worksheet = XLSX.utils.json_to_sheet(normalizedRows);
    worksheet["!cols"] = computeWorksheetColumnWidths(normalizedRows);
    XLSX.utils.book_append_sheet(workbook, worksheet, toSheetName(section, index));
    index += 1;
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

export async function getAnevDashboard(req, res) {
  try {
    const { error, summary } = await fetchAnevSummary(req);
    if (error) {
      return res.status(error.status).json(error.payload);
    }

    return res.json({ success: true, data: summary });
  } catch (err) {
    if (err instanceof UserDirectoryError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    sendConsoleDebug({ tag: "ANEV", msg: `Error getAnevDashboard: ${err.message}` });
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function exportAnevDashboard(req, res) {
  try {
    const { error, summary } = await fetchAnevSummary(req);
    if (error) {
      return res.status(error.status).json(error.payload);
    }

    const section = req.query.section ? String(req.query.section).trim().toLowerCase() : null;
    const rows = buildExportRows(summary, section);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Data export tidak ditemukan" });
    }
    const suffix = section ? `-${section}` : "";
    const fileName = `anev-polres-${(summary?.filters?.client_id || "client").toString().toLowerCase()}-${summary?.filters?.time_range || "custom"}${suffix}`;
    const buffer = buildWorkbookBuffer(rows);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}.xlsx"`);
    return res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof UserDirectoryError) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    sendConsoleDebug({ tag: "ANEV", msg: `Error exportAnevDashboard: ${err.message}` });
    return res.status(500).json({ success: false, message: err.message });
  }
}
