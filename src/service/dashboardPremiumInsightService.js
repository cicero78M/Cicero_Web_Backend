import * as clientModel from '../model/clientModel.js';
import { getRekapLikesByClient } from '../model/instaLikeModel.js';
import { getRekapKomentarByClient } from '../model/tiktokCommentModel.js';
import { formatLikesRecapResponse } from '../utils/likesRecapFormatter.js';
import { formatTiktokCommentRecapResponse } from '../utils/tiktokCommentRecapFormatter.js';
import { validateDateRange, validateTanggalFilter } from '../utils/dateFilterValidation.js';

const DIRECTORATE_ROLES = ['ditbinmas', 'ditlantas', 'bidhumas', 'ditsamapta', 'ditintelkam'];
const DIRECTORATE_ROLE_CLIENT_MAP = {
  ditbinmas: ['ditbinmas'],
  ditintelkam: ['ditintelkam'],
  ditlantas: ['ditlantas'],
  bidhumas: ['bidhumas'],
  ditsamapta: ['ditsamapta'],
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeClientId(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeClientIdLower(value) {
  const normalized = normalizeClientId(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isSatikSwitchEnabled(value) {
  if (value === true) return true;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y', 't'].includes(value.trim().toLowerCase());
  if (typeof value === 'number') return value === 1;
  return false;
}

function shouldEnableSatikFilter({ scope, role, targetClient }) {
  const normalizedScope = String(scope || '').toLowerCase();
  if (!['org', 'direktorat'].includes(normalizedScope)) return false;
  if (String(role || '').toLowerCase() !== 'ditintelkam') return false;
  if (!targetClient) return false;

  const clientType = String(targetClient.client_type || '').toLowerCase();
  if (normalizedScope === 'org') return clientType === 'org';
  return clientType === 'direktorat' && isSatikSwitchEnabled(targetClient.switch_satik);
}

function isMappedDirectorateClient({ scope, role, clientId }) {
  if (String(scope || '').toLowerCase() !== 'direktorat') return false;
  const roleKey = String(role || '').toLowerCase();
  const normalizedClientId = normalizeClientIdLower(clientId);
  if (!normalizedClientId) return false;
  const allowedClients = DIRECTORATE_ROLE_CLIENT_MAP[roleKey];
  if (!allowedClients) return false;
  return allowedClients.includes(normalizedClientId);
}

function getDashboardUser(reqUser = {}) {
  return reqUser || {};
}

function resolvePeriodLabel({ periode = 'harian', tanggal, startDate, endDate }) {
  if (tanggal) return tanggal;
  if (startDate && endDate) return `${startDate} s/d ${endDate}`;
  if (startDate) return startDate;
  return periode;
}

async function resolveDashboardQueryContext(dashboardUser, query = {}) {
  const user = getDashboardUser(dashboardUser);
  const clientIds = Array.isArray(user.client_ids) ? user.client_ids : user.client_id ? [user.client_id] : [];
  const normalizedAllowedClientIds = clientIds.map((id) => normalizeClientIdLower(id)).filter(Boolean);
  const requestedRole = normalizeString(query.role) || normalizeString(user.role);
  const requestedScope = normalizeString(query.scope) || normalizeString(user.scope) || 'org';
  const clientId = normalizeClientId(query.client_id || user.client_id || clientIds[0]);
  const regionalId = normalizeString(query.regional_id || user.regional_id);
  const periode = normalizeString(query.periode) || 'harian';
  const tanggal = normalizeString(query.tanggal);
  const startDate = normalizeString(query.start_date || query.tanggal_mulai);
  const endDate = normalizeString(query.end_date || query.tanggal_selesai);
  const roleLower = requestedRole ? requestedRole.toLowerCase() : null;
  const scopeLower = requestedScope ? requestedScope.toLowerCase() : 'org';

  if (!clientId) throw createHttpError(400, 'client_id wajib diisi');
  if (!requestedRole) throw createHttpError(400, 'role wajib diisi');
  if (!['org', 'direktorat'].includes(scopeLower)) throw createHttpError(400, 'scope tidak valid');

  if (normalizedAllowedClientIds.length > 0) {
    const requestedClientLower = normalizeClientIdLower(clientId);
    if (!normalizedAllowedClientIds.includes(requestedClientLower) && roleLower !== requestedClientLower) {
      throw createHttpError(403, 'client_id tidak diizinkan');
    }
  }

  const { error: tanggalError } = validateTanggalFilter(tanggal, periode);
  if (tanggalError) throw createHttpError(400, tanggalError);
  const { error: dateRangeError } = validateDateRange(startDate, endDate);
  if (dateRangeError) throw createHttpError(400, dateRangeError);

  return {
    dashboardUser: user,
    clientId,
    role: requestedRole,
    roleLower,
    scope: requestedScope,
    scopeLower,
    regionalId,
    periode,
    tanggal,
    startDate,
    endDate,
    periodLabel: resolvePeriodLabel({ periode, tanggal, startDate, endDate }),
  };
}

async function getInstagramRecap(context) {
  const { clientId, roleLower, scopeLower, regionalId, periode, tanggal, startDate, endDate, dashboardUser } = context;
  let rekapOptions = { regionalId };
  let roleForQuery = context.role;

  const tokenClientId = normalizeClientId(dashboardUser.client_id);
  if (!tokenClientId) {
    throw createHttpError(400, 'client_id pengguna tidak ditemukan');
  }

  if (DIRECTORATE_ROLES.includes(roleLower) && scopeLower === 'direktorat' && !isMappedDirectorateClient({
    scope: scopeLower,
    role: roleLower,
    clientId,
  })) {
    throw createHttpError(403, 'client_id tidak diizinkan');
  }

  let postClientId = clientId;
  let userClientId = clientId;
  let userRoleFilter = null;
  let includePostRoleFilter = false;
  let postRoleFilterName;
  let matchLikeClientId = true;
  let officialAccountsOnly = false;
  let tokenClient = null;

  if (scopeLower === 'org') {
    tokenClient = await clientModel.findById(tokenClientId);
  }

  if (scopeLower === 'direktorat') {
    postClientId = clientId;
    userClientId = null;
    userRoleFilter = roleLower;
    includePostRoleFilter = true;
    postRoleFilterName = roleLower;

    const targetClient = await clientModel.findById(postClientId);
    if (shouldEnableSatikFilter({ scope: scopeLower, role: roleLower, targetClient })) {
      rekapOptions.satikDivisionMode = 'org_include_only';
    }
  } else if (scopeLower === 'org') {
    const isCrossOrgDirectorateRole = DIRECTORATE_ROLES.includes(roleLower);
    if (!isCrossOrgDirectorateRole) {
      postClientId = tokenClientId;
      userClientId = tokenClientId;
    }

    if (roleLower === 'operator') {
      userRoleFilter = 'operator';
      officialAccountsOnly = tokenClient?.client_type?.toLowerCase() === 'org';
    } else if (DIRECTORATE_ROLES.includes(roleLower)) {
      postClientId = roleLower;
      userClientId = clientId;
      userRoleFilter = roleLower;
      includePostRoleFilter = false;
      postRoleFilterName = undefined;
      matchLikeClientId = false;

      const targetClient = tokenClient && userClientId === tokenClientId
        ? tokenClient
        : await clientModel.findById(userClientId);
      if (shouldEnableSatikFilter({ scope: scopeLower, role: roleLower, targetClient })) {
        rekapOptions.satikDivisionMode = 'include_only';
      }
    }
  }

  rekapOptions = {
    postClientId,
    userClientId,
    userRoleFilter,
    includePostRoleFilter,
    postRoleFilterName,
    matchLikeClientId,
    officialAccountsOnly,
    regionalId,
    satikDivisionMode: rekapOptions.satikDivisionMode,
  };
  roleForQuery = roleLower;

  const { rows, totalKonten, taskLinksToday } = await getRekapLikesByClient(
    clientId,
    periode,
    tanggal,
    startDate,
    endDate,
    roleForQuery,
    rekapOptions,
  );

  return formatLikesRecapResponse(rows, totalKonten, taskLinksToday);
}

async function getTiktokRecap(context) {
  const { clientId, roleLower, scopeLower, regionalId, periode, tanggal, startDate, endDate, dashboardUser } = context;
  let rekapOptions = { userRegionalId: regionalId, postRegionalId: regionalId };
  let roleForQuery = context.role;

  if (scopeLower === 'direktorat' && DIRECTORATE_ROLES.includes(roleLower) && !isMappedDirectorateClient({
    scope: scopeLower,
    role: roleLower,
    clientId,
  })) {
    throw createHttpError(403, 'client_id tidak diizinkan');
  }

  let postClientId = clientId;
  let userClientId = clientId;
  let userRoleFilter = null;

  if (scopeLower === 'direktorat') {
    postClientId = clientId;
    userClientId = null;
    userRoleFilter = roleLower;
    const targetClient = await clientModel.findById(postClientId);
    if (shouldEnableSatikFilter({ scope: scopeLower, role: roleLower, targetClient })) {
      rekapOptions.satikDivisionMode = 'org_include_only';
    }
  } else if (scopeLower === 'org') {
    if (roleLower === 'operator') {
      const tokenClientId = dashboardUser.client_id;
      if (!tokenClientId) throw createHttpError(400, 'client_id pengguna tidak ditemukan');
      postClientId = tokenClientId;
      userClientId = tokenClientId;
      userRoleFilter = 'operator';
    } else if (DIRECTORATE_ROLES.includes(roleLower)) {
      postClientId = roleLower;
      userClientId = clientId;
      userRoleFilter = roleLower;
      const targetClient = await clientModel.findById(userClientId);
      if (shouldEnableSatikFilter({ scope: scopeLower, role: roleLower, targetClient })) {
        rekapOptions.satikDivisionMode = 'include_only';
      }
    }
  }

  rekapOptions = {
    postClientId,
    userClientId,
    userRoleFilter,
    includePostRoleFilter: scopeLower === 'direktorat',
    postRoleFilterMode: scopeLower === 'direktorat' ? 'include_client_or_role' : undefined,
    userRegionalId: regionalId,
    postRegionalId: regionalId,
    satikDivisionMode: rekapOptions.satikDivisionMode,
    includeTaskLinks: true,
  };
  roleForQuery = roleLower;

  const result = await getRekapKomentarByClient(
    clientId,
    periode,
    tanggal,
    startDate,
    endDate,
    roleForQuery,
    rekapOptions,
  );

  const rows = Array.isArray(result) ? result : result?.rows || [];
  const totalPosts = Array.isArray(result)
    ? (rows.length > 0 ? rows[0]?.total_konten : 0)
    : result?.totalKonten;
  const taskLinksToday = Array.isArray(result) ? undefined : result?.taskLinksToday;

  return formatTiktokCommentRecapResponse(rows, totalPosts, taskLinksToday);
}

async function getClientName(clientId) {
  const client = await clientModel.findById(clientId);
  return client?.nama || client?.client_name || clientId;
}

function buildExecutiveNarrative({ platformLabel, periodLabel, clientName, recap }) {
  const summary = recap?.summary || {};
  const distribution = summary.distribution || {};
  const completedCount = Number(distribution.sudah || 0);
  const partialCount = Number(distribution.kurang || 0);
  const notStartedCount = Number(distribution.belum || 0);
  const missingUsernameCount = Number(distribution.noUsername || 0);
  const totalUsers = Number(summary.totalUsers || 0);
  const totalPosts = Number(summary.totalPosts || 0);
  const complianceRate = Number(summary.averageCompletionPercentage || 0);
  const actionNeededCount = partialCount + notStartedCount;

  const lines = [
    `Briefing ${platformLabel}`,
    `Periode: ${periodLabel}`,
    `Client: ${clientName}`,
    '',
    `- Total personel terpantau: ${totalUsers}`,
    `- Total konten/post: ${totalPosts}`,
    `- Sudah lengkap: ${completedCount}`,
    `- Kurang lengkap: ${partialCount}`,
    `- Belum mulai: ${notStartedCount}`,
    `- Tanpa username: ${missingUsernameCount}`,
    `- Kepatuhan aktif: ${Math.round(complianceRate)}%`,
    '',
    'Arah tindak lanjut:',
    actionNeededCount > 0
      ? `- Prioritaskan ${actionNeededCount} akun yang masih perlu aksi sebelum briefing berikutnya.`
      : '- Seluruh akun aktif sudah aman, lanjutkan monitoring rutin.',
    missingUsernameCount > 0
      ? `- Rapikan ${missingUsernameCount} akun tanpa username agar blindspot monitoring berkurang.`
      : '- Data username sudah rapi dan siap dipakai untuk kontrol harian.',
  ];

  return {
    platform: platformLabel.toLowerCase(),
    periodLabel,
    clientName,
    summary: actionNeededCount > 0
      ? `${actionNeededCount} akun masih perlu aksi pada ${periodLabel}.`
      : `Semua akun aktif ${platformLabel.toLowerCase()} aman pada ${periodLabel}.`,
    stats: {
      totalUsers,
      totalPosts,
      completedCount,
      partialCount,
      notStartedCount,
      missingUsernameCount,
      complianceRate: Number(complianceRate.toFixed(1)),
    },
    text: lines.join('\n'),
  };
}

export function buildRiskSummaryFromRecap({ platformLabel, periodLabel, recap }) {
  const summary = recap?.summary || {};
  const distribution = summary.distribution || {};
  const completedCount = Number(distribution.sudah || 0);
  const partialCount = Number(distribution.kurang || 0);
  const notStartedCount = Number(distribution.belum || 0);
  const missingUsernameCount = Number(distribution.noUsername || 0);
  const totalUsers = Number(summary.totalUsers || 0);
  const activeUsers = Math.max(totalUsers - missingUsernameCount, 0);
  const actionNeededCount = partialCount + notStartedCount;
  const complianceRate = Number(summary.averageCompletionPercentage || 0);
  const actionNeededRate = activeUsers > 0 ? Number(((actionNeededCount / activeUsers) * 100).toFixed(1)) : 0;

  const alerts = [];
  if (notStartedCount > 0) {
    alerts.push({
      id: 'not-started',
      severity: notStartedCount >= 8 ? 'high' : 'medium',
      title: `${notStartedCount} akun belum mulai`,
      detail: `${notStartedCount} akun belum melakukan aktivitas ${platformLabel.toLowerCase()} pada ${periodLabel}.`,
      action: 'Dorong follow-up cepat ke akun yang belum mulai.',
    });
  }
  if (partialCount > 0) {
    alerts.push({
      id: 'partial',
      severity: partialCount >= 6 ? 'high' : 'medium',
      title: `${partialCount} akun masih kurang lengkap`,
      detail: `${partialCount} akun sudah bergerak tapi belum memenuhi target ${platformLabel.toLowerCase()}.`,
      action: 'Naikkan akun setengah jalan menjadi tuntas sebelum briefing berikutnya.',
    });
  }
  if (missingUsernameCount > 0) {
    alerts.push({
      id: 'missing-username',
      severity: missingUsernameCount >= 4 ? 'medium' : 'low',
      title: `${missingUsernameCount} akun punya blindspot data`,
      detail: `${missingUsernameCount} akun tanpa username belum ikut hitungan kepatuhan penuh.`,
      action: 'Rapikan username agar monitoring tidak bocor.',
    });
  }
  if (complianceRate < 70) {
    alerts.push({
      id: 'compliance',
      severity: complianceRate < 50 ? 'high' : 'medium',
      title: `Kepatuhan aktif baru ${Math.round(complianceRate)}%`,
      detail: `Kepatuhan ${platformLabel.toLowerCase()} masih di bawah zona aman untuk ${periodLabel}.`,
      action: 'Gunakan briefing harian sebagai alat kendali, bukan hanya rekap akhir.',
    });
  }
  if (alerts.length === 0) {
    alerts.push({
      id: 'stable',
      severity: 'low',
      title: 'Kondisi relatif aman',
      detail: `Belum ada sinyal risiko besar pada ${platformLabel.toLowerCase()} untuk ${periodLabel}.`,
      action: 'Pertahankan ritme monitoring dan kebersihan data.',
    });
  }

  return {
    platform: platformLabel.toLowerCase(),
    periodLabel,
    complianceRate: Number(complianceRate.toFixed(1)),
    actionNeededCount,
    actionNeededRate,
    missingUsernameCount,
    totalUsers,
    completedCount,
    alerts,
  };
}

async function getPlatformRecap(platform, context) {
  if (platform === 'instagram') return getInstagramRecap(context);
  if (platform === 'tiktok') return getTiktokRecap(context);
  throw createHttpError(400, 'platform tidak valid');
}

function normalizePlatform(value) {
  return String(value || '').trim().toLowerCase();
}

export async function getDashboardPremiumExecutiveRecap({ dashboardUser, query }) {
  const context = await resolveDashboardQueryContext(dashboardUser, query);
  const platform = normalizePlatform(query.platform);
  if (!['instagram', 'tiktok'].includes(platform)) {
    throw createHttpError(400, 'platform harus instagram atau tiktok');
  }

  const recap = await getPlatformRecap(platform, context);
  const clientName = await getClientName(context.clientId);
  const platformLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';

  return {
    success: true,
    data: buildExecutiveNarrative({
      platformLabel,
      periodLabel: context.periodLabel,
      clientName,
      recap,
    }),
  };
}

export async function getDashboardPremiumRiskSummary({ dashboardUser, query }) {
  const context = await resolveDashboardQueryContext(dashboardUser, query);
  const platform = normalizePlatform(query.platform);
  if (!['instagram', 'tiktok'].includes(platform)) {
    throw createHttpError(400, 'platform harus instagram atau tiktok');
  }

  const recap = await getPlatformRecap(platform, context);
  const platformLabel = platform === 'tiktok' ? 'TikTok' : 'Instagram';

  return {
    success: true,
    data: buildRiskSummaryFromRecap({
      platformLabel,
      periodLabel: context.periodLabel,
      recap,
    }),
  };
}
