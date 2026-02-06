// src/controller/dashboardController.js
import { getAllClients } from "../model/clientModel.js";
import { getAllUsers } from "../model/userModel.js";
import { getInstaPostCount, getTiktokPostCount } from "../service/postCountService.js";
import { sendConsoleDebug } from "../middleware/debugHandler.js";

const DIRECTORATE_ROLES = ["ditbinmas", "ditlantas", "bidhumas", "ditsamapta", "ditintelkam"];

export async function getDashboardStats(req, res) {
  try {
    const requestedScope = req.query.scope;
    const requestedRole = req.query.role || req.user?.role;
    const requestedRegionalId = req.query.regional_id || req.user?.regional_id;
    const roleLower = requestedRole ? String(requestedRole).toLowerCase() : null;
    const scopeLower = requestedScope ? String(requestedScope).toLowerCase() : null;
    const regionalId = requestedRegionalId
      ? String(requestedRegionalId).trim().toUpperCase()
      : null;
    const usesStandardPayload = Boolean(req.query.role || req.query.scope);

    let client_id =
      req.user?.role === "operator"
        ? req.user?.client_id
        : req.query.client_id || req.user?.client_id || req.headers["x-client-id"];

    if (!usesStandardPayload && roleLower === "ditbinmas") {
      client_id = "ditbinmas";
    }

    if (!client_id) {
      return res
        .status(400)
        .json({ success: false, message: "client_id wajib diisi" });
    }

    if (req.user?.client_ids) {
      const userClientIds = Array.isArray(req.user.client_ids)
        ? req.user.client_ids
        : [req.user.client_ids];
      const idsLower = userClientIds.map((c) => String(c).toLowerCase());
      if (
        !idsLower.includes(client_id.toLowerCase()) &&
        roleLower !== client_id.toLowerCase()
      ) {
        return res
          .status(403)
          .json({ success: false, message: "client_id tidak diizinkan" });
      }
    }
    if (
      req.user?.client_id &&
      req.user.client_id.toLowerCase() !== client_id.toLowerCase() &&
      roleLower !== client_id.toLowerCase()
    ) {
      return res
        .status(403)
        .json({ success: false, message: "client_id tidak diizinkan" });
    }

    const periode = req.query.periode || "harian";
    const tanggal = req.query.tanggal;
    const start_date = req.query.start_date || req.query.tanggal_mulai;
    const end_date = req.query.end_date || req.query.tanggal_selesai;
    const requiresRealtimeConsistency = Boolean(tanggal);

    let resolvedRole = roleLower || null;
    let resolvedScope = scopeLower || req.user?.scope || null;
    let postClientId = client_id;
    const tokenClientId = req.user?.client_id || null;
    let igClientIdOverride = null;

    if (usesStandardPayload) {
      resolvedScope = scopeLower || "org";
      if (!["org", "direktorat"].includes(resolvedScope)) {
        return res
          .status(400)
          .json({ success: false, message: "scope tidak valid" });
      }
      if (!resolvedRole) {
        return res
          .status(400)
          .json({ success: false, message: "role wajib diisi" });
      }

      if (resolvedScope === "direktorat") {
        postClientId = client_id;
      } else if (resolvedScope === "org") {
        if (resolvedRole === "operator") {
          if (!tokenClientId) {
            return res.status(400).json({
              success: false,
              message: "client_id pengguna tidak ditemukan",
            });
          }
          igClientIdOverride = tokenClientId;
          postClientId = tokenClientId;
        } else if (DIRECTORATE_ROLES.includes(resolvedRole)) {
          postClientId = resolvedRole;
        }
      }
    }

    if (resolvedScope === "org" && resolvedRole === "operator") {
      if (!tokenClientId) {
        return res.status(400).json({
          success: false,
          message: "client_id pengguna tidak ditemukan",
        });
      }
      igClientIdOverride = tokenClientId;
    }

    const shouldFilterOperatorUsers =
      resolvedScope === "org" && resolvedRole === "operator";
    const userRoleFilter = shouldFilterOperatorUsers ? "operator" : null;

    const [clients, users, igPostCount, ttPostCount] = await Promise.all([
      getAllClients(),
      getAllUsers(postClientId, userRoleFilter),
      getInstaPostCount(postClientId, periode, tanggal, start_date, end_date, {
        role: resolvedRole,
        scope: resolvedScope,
        regionalId,
        igClientIdOverride,
        useCache: !requiresRealtimeConsistency,
      }),
      getTiktokPostCount(postClientId, periode, tanggal, start_date, end_date, {
        role: resolvedRole,
        scope: resolvedScope,
        regionalId,
        useCache: !requiresRealtimeConsistency,
      }),
    ]);

    const activeUsers = Array.isArray(users) ? users.filter((u) => u.status === true) : [];

    res.json({
      success: true,
      data: {
        client_id: postClientId,
        role: resolvedRole,
        scope: resolvedScope,
        regional_id: regionalId,
        clients: Array.isArray(clients) ? clients.length : 0,
        users: activeUsers.length,
        igPosts: igPostCount,
        ttPosts: ttPostCount,
      },
    });
  } catch (err) {
    sendConsoleDebug({ tag: "DASHBOARD", msg: `Error getDashboardStats: ${err.message}` });
    res.status(500).json({ success: false, message: err.message });
  }
}
