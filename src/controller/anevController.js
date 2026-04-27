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

function buildExportRows(summary) {
  const filters = summary?.filters || {};
  const context = {
    time_range: filters.time_range || "",
    start_date: filters.start_date || "",
    end_date: filters.end_date || "",
    role: filters.role || "",
    scope: filters.scope || "",
    regional_id: filters.regional_id || "",
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
  platforms.forEach((entry) => {
    rows.push({
      section: "posting_per_platform",
      platform: entry?.platform || "",
      posts: Number(entry?.posts || 0),
      ...context,
    });
  });

  const complianceRows =
    (Array.isArray(totals.compliance_per_pelaksana) && totals.compliance_per_pelaksana) ||
    (Array.isArray(aggregates.compliance_per_pelaksana) && aggregates.compliance_per_pelaksana) ||
    [];
  complianceRows.forEach((entry) => {
    rows.push({
      section: "compliance_per_pelaksana",
      pelaksana: entry?.nama || entry?.name || entry?.pelaksana || "-",
      assigned: Number(entry?.assigned || 0),
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
      posts: Number(entry?.posts || 0),
      comments: Number(entry?.comments || 0),
      engagement: Number(entry?.engagement || entry?.comments || 0),
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
      likes: Number(entry?.likes || 0),
      ...context,
    });
  });

  return rows;
}

function toSheetName(section, index) {
  const fallback = `Sheet${index}`;
  const raw = String(section || fallback).trim() || fallback;
  return raw.replace(/[\\/?*[\]:]/g, "-").replace(/\s+/g, "_").slice(0, 31);
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
      return clone;
    });
    const worksheet = XLSX.utils.json_to_sheet(normalizedRows);
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

    const rows = buildExportRows(summary);
    const fileName = `anev-polres-${(summary?.filters?.client_id || "client").toString().toLowerCase()}-${summary?.filters?.time_range || "custom"}`;
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
