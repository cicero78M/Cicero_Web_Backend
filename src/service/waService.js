// =======================
// IMPORTS & KONFIGURASI
// =======================
import qrcode from "qrcode-terminal";
import PQueue from "p-queue";
import dotenv from "dotenv";
import fs from "fs";
import os from "os";
import path from "path";
import { query } from "../db/index.js";
import { env } from "../config/env.js";
const pool = { query };

// WhatsApp client using baileys
import { createBaileysClient } from "./baileysAdapter.js";
import {
  logWaServiceDiagnostics,
  checkMessageListenersAttached,
} from "../utils/waDiagnostics.js";

// Service & Utility Imports
import * as clientService from "./clientService.js";
import * as userModel from "../model/userModel.js";
import * as dashboardUserModel from "../model/dashboardUserModel.js";
import * as satbinmasOfficialAccountService from "./satbinmasOfficialAccountService.js";
import { findByOperator, findBySuperAdmin } from "../model/clientModel.js";
import * as premiumService from "./premiumService.js";
import * as premiumReqModel from "../model/premiumRequestModel.js";
import { migrateUsersFromFolder } from "./userMigrationService.js";
import { checkGoogleSheetCsvStatus } from "./checkGoogleSheetAccess.js";
import { importUsersFromGoogleSheet } from "./importUsersFromGoogleSheet.js";
import { fetchAndStoreInstaContent } from "../handler/fetchpost/instaFetchPost.js";
import { handleFetchLikesInstagram } from "../handler/fetchengagement/fetchLikesInstagram.js";
import {
  getTiktokSecUid,
  fetchAndStoreTiktokContent,
} from "../handler/fetchpost/tiktokFetchPost.js";
import { fetchInstagramProfile } from "./instagramApi.js";
import { fetchTiktokProfile } from "./tiktokRapidService.js";
import {
  saveContactIfNew,
  authorize,
  searchByNumbers,
  saveGoogleContact,
} from "./googleContactsService.js";

import {
  absensiLikes,
  absensiLikesPerKonten,
} from "../handler/fetchabsensi/insta/absensiLikesInsta.js";

import {
  absensiKomentar,
  absensiKomentarTiktokPerKonten,
} from "../handler/fetchabsensi/tiktok/absensiKomentarTiktok.js";

// Model Imports
import { getLikesByShortcode } from "../model/instaLikeModel.js";
import { getShortcodesTodayByClient } from "../model/instaPostModel.js";
import { getUsersByClient } from "../model/userModel.js";

// Handler Imports
import {
  BULK_STATUS_HEADER_REGEX,
  clientRequestHandlers,
  processBulkDeletionRequest,
} from "../handler/menu/clientRequestHandlers.js";

import { handleFetchKomentarTiktokBatch } from "../handler/fetchengagement/fetchCommentTiktok.js";

// >>> Session helpers - only keep what's actively used <<<
import {
  adminOptionSessions,
  setSession,
  getSession,
  clearSession,
} from "../utils/sessionsHelper.js";

import {
  formatNama,
  groupByDivision,
  sortDivisionKeys,
  normalizeKomentarArr,
  getGreeting,
  formatUserData,
} from "../utils/utilsHelper.js";
import {
  handleComplaintMessageIfApplicable,
  isGatewayComplaintForward,
} from "./waAutoComplaintService.js";
import {
  isAdminWhatsApp,
  isAdminWhatsAppAsync,
  formatToWhatsAppId,
  formatClientData,
  safeSendMessage,
  getAdminWAIds,
  isUnsupportedVersionError,
  sendWAReport,
  sendWithClientFallback,
} from "../utils/waHelper.js";
import {
  IG_PROFILE_REGEX,
  TT_PROFILE_REGEX,
  adminCommands,
} from "../utils/constants.js";
import {
  approveDashboardPremiumRequest,
  denyDashboardPremiumRequest,
  findLatestOpenDashboardPremiumRequestByIdentifier,
} from "./dashboardPremiumRequestService.js";

dotenv.config();

const messageQueues = new WeakMap();

// Note: WhatsApp bot is configured for SEND-ONLY mode. Message reception has been disabled.
// Client initialization is still required for sending messages.
// Can be skipped in test environments using WA_SERVICE_SKIP_INIT=true
const shouldInitWhatsAppClients = process.env.WA_SERVICE_SKIP_INIT !== "true";

// Response delay for message queue (in milliseconds)
// Default is 0 (no delay) since the queue already handles concurrency
const responseDelayMs = Number(process.env.WA_RESPONSE_DELAY_MS || 0);

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Helper ringkas untuk menampilkan data user
function formatUserSummary(user) {
  const polresName = user.client_name || user.client_id || "-";
  return (
    "👤 *Identitas Anda*\n" +
    `*Nama Polres*: ${polresName}\n` +
    `*Nama*     : ${user.nama || "-"}\n` +
    `*Pangkat*  : ${user.title || "-"}\n` +
    `*NRP/NIP*  : ${user.user_id || "-"}\n` +
    `*Satfung*  : ${user.divisi || "-"}\n` +
    `*Jabatan*  : ${user.jabatan || "-"}\n` +
    (user.ditbinmas ? `*Desa Binaan* : ${user.desa || "-"}\n` : "") +
    `*Instagram*: ${user.insta ? "@" + user.insta.replace(/^@/, "") : "-"}\n` +
    `*TikTok*   : ${user.tiktok || "-"}\n` +
    `*Status*   : ${
      user.status === true || user.status === "true" ? "🟢 AKTIF" : "🔴 NONAKTIF"
    }`
  ).trim();
}

const numberFormatter = new Intl.NumberFormat("id-ID");

function formatCount(value) {
  return numberFormatter.format(Math.max(0, Math.floor(Number(value) || 0)));
}

function formatCurrencyId(value) {
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `Rp ${numberFormatter.format(numeric)}`;
}

async function runMenuHandler({
  handlers,
  menuName,
  session,
  chatId,
  text,
  waClient,
  args = [],
  clientLabel = "[WA]",
  invalidStepMessage,
  failureMessage,
}) {
  const step = session?.step || "main";
  const handler = handlers[step];
  if (typeof handler !== "function") {
    clearSession(chatId);
    await safeSendMessage(
      waClient,
      chatId,
      invalidStepMessage ||
        `⚠️ Sesi menu ${menuName} tidak dikenali. Ketik *${menuName}* ulang atau *batal*.`
    );
    return false;
  }

  try {
    await handler(session, chatId, text, waClient, ...args);
    return true;
  } catch (err) {
    console.error(
      `${clientLabel} ${menuName} handler failed (step=${step}): ${err?.stack || err}`
    );
    clearSession(chatId);
    await safeSendMessage(
      waClient,
      chatId,
      failureMessage ||
        `❌ Terjadi kesalahan pada menu ${menuName}. Silakan ketik *${menuName}* ulang.`
    );
    return true;
  }
}

export function buildDashboardPremiumRequestMessage(request) {
  if (!request) return "";
  const commandUsername = request.username || request.dashboard_user_id || "unknown";
  const paymentProofStatus = request.proof_url
    ? "sudah upload bukti transfer"
    : "belum upload bukti transfer";
  const paymentProofLink = request.proof_url || "Belum upload bukti";
  const lines = [
    "📢 permintaan akses premium",
    "",
    "User dashboard:",
    `- Username: ${commandUsername}`,
    `- WhatsApp: ${formatToWhatsAppId(request.whatsapp) || "-"}`,
    `- Dashboard User ID: ${request.dashboard_user_id || "-"}`,
    "",
    "Detail permintaan:",
    `- Tier: ${request.premium_tier || "-"}`,
    `- Client ID: ${request.client_id || "-"}`,
    `- Username (request): ${commandUsername}`,
    `- Dashboard User ID (request): ${request.dashboard_user_id || "-"}`,
    `- Request Token (request): ${request.request_token || "-"}`,
    `- Status Bukti Transfer: ${paymentProofStatus}`,
    "",
    "Detail transfer:",
    `- Bank: ${request.bank_name || "-"}`,
    `- Nomor Rekening: ${request.account_number || "-"}`,
    `- Nama Pengirim: ${request.sender_name || "-"}`,
    `- Jumlah Transfer: ${formatCurrencyId(request.transfer_amount)}`,
    `- Bukti Transfer: ${paymentProofLink}`,
    "",
    `Request ID: ${request.request_id || "-"}`,
    "",
    `Balas dengan <response pesan grant access#${commandUsername}> untuk menyetujui atau <response pesan deny access${commandUsername}> untuk menolak.`,
  ];

  return lines.filter(Boolean).join("\n");
}

export async function sendDashboardPremiumRequestNotification(client, request) {
  if (!request) return false;
  const message = buildDashboardPremiumRequestMessage(request);
  if (!message) return false;
  try {
    await sendWAReport(client || waClient, message);
    return true;
  } catch (err) {
    console.warn(
      `[WA] Failed to broadcast dashboard premium request ${request.request_id}: ${err?.message || err}`
    );
    return false;
  }
}

async function notifyDashboardPremiumRequester(request, statusMessage, client = waClient) {
  if (!request?.whatsapp) return false;
  const targetId = formatToWhatsAppId(request.whatsapp);
  return safeSendMessage(client || waClient, targetId, statusMessage);
}

function formatDateTimeId(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date(value));
  } catch (err) {
    return String(value);
  }
}

function normalizeInstagramUsername(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/^@+/, "").toLowerCase();
  return normalized && /^[a-z0-9._]{1,30}$/.test(normalized) ? normalized : null;
}

function normalizeTiktokUsername(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/^@+/, "").toLowerCase();
  return normalized && /^[a-z0-9._]{1,24}$/.test(normalized) ? normalized : null;
}

function formatSocialUsername(platform, username) {
  const normalized =
    platform === "instagram"
      ? normalizeInstagramUsername(username)
      : normalizeTiktokUsername(username);
  return normalized ? `@${normalized}` : "-";
}

function extractProfileUsername(text) {
  if (!text) return null;
  const trimmed = text.trim();
  let match = trimmed.match(IG_PROFILE_REGEX);
  if (match) {
    const username = normalizeInstagramUsername(match[2]);
    if (!username) return null;
    return {
      platform: "instagram",
      normalized: username,
      storeValue: username,
      display: formatSocialUsername("instagram", username),
    };
  }
  match = trimmed.match(TT_PROFILE_REGEX);
  if (match) {
    const username = normalizeTiktokUsername(match[2]);
    if (!username) return null;
    return {
      platform: "tiktok",
      normalized: username,
      storeValue: `@${username}`,
      display: formatSocialUsername("tiktok", username),
    };
  }
  return null;
}

const QUICK_REPLY_STEPS = new Set([
  "inputUserId",
  "confirmBindUser",
  "confirmBindUpdate",
  "updateAskField",
  "updateAskValue",
]);

function shouldExpectQuickReply(session) {
  if (!session || session.exit) {
    return false;
  }
  return session.step ? QUICK_REPLY_STEPS.has(session.step) : false;
}

function toNumeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    const num = Number(cleaned);
    if (Number.isFinite(num)) return num;
  }
  return 0;
}

function getPlatformLabel(platform) {
  return platform === "instagram" ? "Instagram" : "TikTok";
}

async function verifyInstagramAccount(username) {
  try {
    const profile = await fetchInstagramProfile(username);
    if (!profile) {
      return { active: false };
    }
    const followerCount = toNumeric(
      profile.followers_count ??
        profile.follower_count ??
        profile.followers ??
        profile.followersCount ??
        profile.edge_followed_by?.count
    );
    const followingCount = toNumeric(
      profile.following_count ??
        profile.following ??
        profile.followingCount ??
        profile.edge_follow?.count
    );
    const postCount = toNumeric(
      profile.media_count ??
        profile.posts_count ??
        profile.post_count ??
        profile.edge_owner_to_timeline_media?.count
    );
    const active = followerCount > 0 && followingCount > 0 && postCount > 0;
    return { active, followerCount, followingCount, postCount, profile };
  } catch (error) {
    return { active: false, error };
  }
}

async function verifyTiktokAccount(username) {
  try {
    const profile = await fetchTiktokProfile(username);
    if (!profile) {
      return { active: false };
    }
    const followerCount = toNumeric(
      profile.follower_count ??
        profile.followerCount ??
        profile.stats?.followerCount
    );
    const followingCount = toNumeric(
      profile.following_count ??
        profile.followingCount ??
        profile.stats?.followingCount
    );
    const postCount = toNumeric(
      profile.video_count ??
        profile.videoCount ??
        profile.stats?.videoCount
    );
    const active = followerCount > 0 && followingCount > 0 && postCount > 0;
    return { active, followerCount, followingCount, postCount, profile };
  } catch (error) {
    return { active: false, error };
  }
}

async function verifySocialAccount(platform, username) {
  if (!username) return { active: false };
  if (platform === "instagram") {
    return verifyInstagramAccount(username);
  }
  return verifyTiktokAccount(username);
}

function formatVerificationSummary(
  context,
  platform,
  displayUsername,
  verification
) {
  if (!displayUsername) {
    return `• ${context}: belum ada username ${getPlatformLabel(platform)} yang tersimpan.`;
  }
  if (!verification) {
    return `• ${context}: ${displayUsername} → belum diperiksa.`;
  }
  if (verification.error) {
    const reason = verification.error?.message || String(verification.error);
    return `• ${context}: ${displayUsername} → gagal diperiksa (${reason}).`;
  }
  if (!verification.active) {
    return `• ${context}: ${displayUsername} → belum terbaca aktif.`;
  }
  return (
    `• ${context}: ${displayUsername} → aktif ` +
    `(Postingan: ${formatCount(verification.postCount)}, ` +
    `Follower: ${formatCount(verification.followerCount)}, ` +
    `Following: ${formatCount(verification.followingCount)})`
  );
}

// =======================
// INISIALISASI CLIENT WA
// =======================

// Initialize single WhatsApp client using baileys
export let waClient = await createBaileysClient('wa-admin');

const clientReadiness = new Map();
const adminNotificationQueue = [];
const authenticatedReadyFallbackTimers = new Map();
const authenticatedReadyTimeoutMs = Number.isNaN(
  Number(process.env.WA_AUTH_READY_TIMEOUT_MS)
)
  ? 45000
  : Number(process.env.WA_AUTH_READY_TIMEOUT_MS);
const fallbackReadyCheckDelayMs = Number.isNaN(
  Number(process.env.WA_FALLBACK_READY_DELAY_MS)
)
  ? 60000
  : Number(process.env.WA_FALLBACK_READY_DELAY_MS);
const fallbackReadyCooldownMs = Number.isNaN(
  Number(process.env.WA_FALLBACK_READY_COOLDOWN_MS)
)
  ? 300000
  : Math.max(0, Number(process.env.WA_FALLBACK_READY_COOLDOWN_MS));
const defaultReadyTimeoutMs = Number.isNaN(
  Number(process.env.WA_READY_TIMEOUT_MS)
)
  ? Math.max(authenticatedReadyTimeoutMs, fallbackReadyCheckDelayMs + 5000)
  : Number(process.env.WA_READY_TIMEOUT_MS);
const fallbackStateRetryCounts = new WeakMap();
const fallbackReinitCounts = new WeakMap();
const maxFallbackStateRetries = 3;
const maxFallbackReinitAttempts = 2;
const maxUnknownStateEscalationRetries = 2;
const fallbackStateRetryMinDelayMs = 15000;
const fallbackStateRetryMaxDelayMs = 30000;
const connectInFlightWarnMs = Number.isNaN(
  Number(process.env.WA_CONNECT_INFLIGHT_WARN_MS)
)
  ? 120000
  : Number(process.env.WA_CONNECT_INFLIGHT_WARN_MS);
const connectInFlightReinitMs = Number.isNaN(
  Number(process.env.WA_CONNECT_INFLIGHT_REINIT_MS)
)
  ? 300000
  : Number(process.env.WA_CONNECT_INFLIGHT_REINIT_MS);
const hardInitRetryCounts = new WeakMap();
const maxHardInitRetries = 3;
const hardInitRetryBaseDelayMs = 120000;
const hardInitRetryMaxDelayMs = 900000;
const qrAwaitingReinitGraceMs = 120000;
const logoutDisconnectReasons = new Set([
  "LOGGED_OUT",
  "UNPAIRED",
  "CONFLICT",
  "UNPAIRED_IDLE",
]);
const disconnectChangeStates = new Set([
  "DISCONNECTED",
  "UNPAIRED",
  "UNPAIRED_IDLE",
  "CONFLICT",
  "LOGGED_OUT",
  "CLOSE",
]);
const authSessionIgnoreEntries = new Set([
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
]);

function getFallbackStateRetryDelayMs() {
  const jitterRange = fallbackStateRetryMaxDelayMs - fallbackStateRetryMinDelayMs;
  return (
    fallbackStateRetryMinDelayMs + Math.floor(Math.random() * jitterRange)
  );
}

function getHardInitRetryDelayMs(attempt) {
  const baseDelay = hardInitRetryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
  const cappedDelay = Math.min(baseDelay, hardInitRetryMaxDelayMs);
  const jitter = Math.floor(Math.random() * 0.2 * cappedDelay);
  return cappedDelay + jitter;
}

function formatConnectDurationMs(durationMs) {
  const seconds = Math.round(durationMs / 1000);
  return `${durationMs}ms (${seconds}s)`;
}

function hasRecentQrScan(state, graceMs = qrAwaitingReinitGraceMs) {
  if (!state?.lastQrAt) {
    return false;
  }
  const elapsedMs = Date.now() - state.lastQrAt;
  return elapsedMs >= 0 && elapsedMs <= graceMs;
}

function getClientReadyTimeoutMs(client) {
  const clientOverride = client?.readyTimeoutMs;
  if (typeof clientOverride === "number" && !Number.isNaN(clientOverride)) {
    return clientOverride;
  }
  return defaultReadyTimeoutMs;
}

function getClientReadinessState(client, label = "WA") {
  if (!clientReadiness.has(client)) {
    clientReadiness.set(client, {
      label,
      ready: false,
      pendingMessages: [],
      readyResolvers: [],
      awaitingQrScan: false,
      lastDisconnectReason: null,
      lastAuthFailureAt: null,
      lastAuthFailureMessage: null,
      lastQrAt: null,
      lastQrPayloadSeen: null,
      unknownStateRetryCount: 0,
      fallbackCheckCompleted: false,
      fallbackCheckInFlight: false,
    });
  }
  return clientReadiness.get(client);
}

function normalizeDisconnectReason(reason) {
  return String(reason || "").trim().toUpperCase();
}

function isLogoutDisconnectReason(reason) {
  const normalizedReason = normalizeDisconnectReason(reason);
  return logoutDisconnectReasons.has(normalizedReason);
}

function hasAuthFailureIndicator(state) {
  return (
    isLogoutDisconnectReason(state?.lastDisconnectReason) ||
    Boolean(state?.lastAuthFailureAt)
  );
}

function hasPersistedAuthSession(sessionPath) {
  if (!sessionPath) {
    return false;
  }
  try {
    if (!fs.existsSync(sessionPath)) {
      return false;
    }
    const entries = fs.readdirSync(sessionPath, { withFileTypes: true });
    return entries.some(
      (entry) => !authSessionIgnoreEntries.has(entry.name)
    );
  } catch (err) {
    console.warn(
      `[WA] Gagal memeriksa isi session di ${sessionPath}:`,
      err?.message || err
    );
    return false;
  }
}

function clearLogoutAwaitingQr(client) {
  const state = getClientReadinessState(client);
  if (state.awaitingQrScan || state.lastDisconnectReason) {
    state.awaitingQrScan = false;
    state.lastDisconnectReason = null;
  }
}

function resetFallbackReadyState(client) {
  const state = getClientReadinessState(client);
  state.fallbackCheckCompleted = false;
  state.fallbackCheckInFlight = false;
}

function markFallbackCheckCompleted(client) {
  const state = getClientReadinessState(client);
  state.fallbackCheckCompleted = true;
  state.fallbackCheckInFlight = false;
}

function clearAuthenticatedFallbackTimer(client) {
  const timer = authenticatedReadyFallbackTimers.get(client);
  if (timer) {
    clearTimeout(timer);
    authenticatedReadyFallbackTimers.delete(client);
  }
}

async function inferClientReadyState(client, label, contextLabel) {
  const state = getClientReadinessState(client, label);
  if (state.ready) {
    return true;
  }
  let readySource = null;
  if (typeof client?.isReady === "function") {
    try {
      if ((await client.isReady()) === true) {
        readySource = "isReady";
      }
    } catch (error) {
      console.warn(
        `[${state.label}] isReady check failed: ${error?.message || error}`
      );
    }
  }
  if (!readySource && typeof client?.getState === "function") {
    try {
      const clientState = await client.getState();
      if (clientState === "CONNECTED" || clientState === "open") {
        readySource = `getState:${clientState}`;
      }
    } catch (error) {
      console.warn(
        `[${state.label}] getState check failed: ${error?.message || error}`
      );
    }
  }
  if (readySource) {
    const contextInfo = contextLabel ? ` during ${contextLabel}` : "";
    console.warn(
      `[${state.label}] Readiness inferred via ${readySource}${contextInfo}; marking ready.`
    );
    markClientReady(client, readySource);
    return true;
  }
  return false;
}

function scheduleAuthenticatedReadyFallback(client, label) {
  clearAuthenticatedFallbackTimer(client);
  const { label: stateLabel } = getClientReadinessState(client, label);
  const timeoutMs = authenticatedReadyTimeoutMs;
  authenticatedReadyFallbackTimers.set(
    client,
    setTimeout(async () => {
      const state = getClientReadinessState(client, stateLabel);
      if (state.ready) {
        return;
      }
      console.warn(
        `[${stateLabel}] Authenticated but no ready event after ${timeoutMs}ms`
      );
      if (client?.isReady) {
        try {
          const isReady = (await client.isReady()) === true;
          if (isReady) {
            console.warn(
              `[${stateLabel}] isReady=true after authenticated timeout; waiting for ready event`
            );
          }
        } catch (error) {
          console.warn(
            `[${stateLabel}] isReady check failed after authenticated timeout: ${error?.message}`
          );
        }
      }
      if (client?.getState) {
        try {
          const currentState = await client.getState();
          console.warn(
            `[${stateLabel}] getState after authenticated timeout: ${currentState}`
          );
        } catch (error) {
          console.warn(
            `[${stateLabel}] getState failed after authenticated timeout: ${error?.message}`
          );
        }
      }
      if (typeof client?.connect === "function") {
        console.warn(
          `[${stateLabel}] Reinitializing client after authenticated timeout`
        );
        reconnectClient(client).catch((err) => {
          console.error(
            `[${stateLabel}] Reinit failed after authenticated timeout: ${err?.message}`
          );
        });
      } else {
        console.warn(
          `[${stateLabel}] connect not available; unable to reinit after authenticated timeout`
        );
      }
    }, timeoutMs)
  );
}

function registerClientReadiness(client, label) {
  getClientReadinessState(client, label);
}

function getInitReadinessIssue({ label, client }) {
  const readinessState = getClientReadinessState(client, label);
  const fatalInitError = client?.fatalInitError || null;
  const missingChrome =
    isFatalMissingChrome(client) || fatalInitError?.type === "missing-chrome";
  const awaitingQrScan = Boolean(readinessState?.awaitingQrScan);
  const authFailure = Boolean(readinessState?.lastAuthFailureAt);
  const hasReadyState = Boolean(readinessState?.ready);

  if (!missingChrome && !fatalInitError && hasReadyState) {
    return null;
  }

  if (missingChrome) {
    return {
      label,
      reason: "missing-chrome",
      detail: fatalInitError?.error?.message || "Chrome executable not found",
      remediation: missingChromeRemediationHint,
    };
  }

  if (authFailure) {
    return {
      label,
      reason: "auth-failure",
      detail:
        readinessState?.lastAuthFailureMessage ||
        "WhatsApp auth failure detected",
      remediation:
        "Pastikan WA_AUTH_DATA_PATH benar, hapus sesi auth yang rusak, lalu scan QR ulang.",
    };
  }

  if (awaitingQrScan) {
    return {
      label,
      reason: "awaiting-qr",
      detail:
        readinessState?.lastDisconnectReason ||
        "Awaiting QR scan for WhatsApp client",
      remediation: "Scan QR terbaru pada log/terminal agar sesi tersambung.",
    };
  }

  if (fatalInitError) {
    return {
      label,
      reason: fatalInitError.type || "fatal-init",
      detail: fatalInitError.error?.message || "Fatal WhatsApp init error",
      remediation:
        "Periksa konfigurasi WhatsApp (WA_WEB_VERSION*, WA_AUTH_DATA_PATH) dan ulangi init.",
    };
  }

  return {
    label,
    reason: "not-ready",
    detail: "WhatsApp client belum siap setelah inisialisasi",
    remediation: "Cek log init, koneksi jaringan, lalu restart jika perlu.",
  };
}

function getListenerCount(client, eventName) {
  if (typeof client?.listenerCount !== "function") {
    return null;
  }
  return client.listenerCount(eventName);
}

export function getWaReadinessSummary() {
  const clients = [
    { label: "WA", client: waClient },
  ];
  const formatTimestamp = (value) =>
    value ? new Date(value).toISOString() : null;
  return {
    shouldInitWhatsAppClients,
    clients: clients.map(({ label, client }) => {
      const state = getClientReadinessState(client, label);
      const puppeteerExecutablePath =
        typeof client?.getPuppeteerExecutablePath === "function"
          ? client.getPuppeteerExecutablePath()
          : client?.puppeteerExecutablePath;
      const fatalInitError = client?.fatalInitError
        ? {
            type: client.fatalInitError.type || null,
            message: client.fatalInitError.error?.message || null,
          }
        : null;
      return {
        label,
        ready: Boolean(state.ready),
        awaitingQrScan: Boolean(state.awaitingQrScan),
        lastDisconnectReason: state.lastDisconnectReason || null,
        lastAuthFailureAt: formatTimestamp(state.lastAuthFailureAt),
        fatalInitError,
        puppeteerExecutablePath: puppeteerExecutablePath || null,
        sessionPath: client?.sessionPath || null,
        messageListenerCount: getListenerCount(client, "message"),
        readyListenerCount: getListenerCount(client, "ready"),
      };
    }),
  };
}

function setClientNotReady(client) {
  const state = getClientReadinessState(client);
  state.ready = false;
  resetFallbackReadyState(client);
}

function resetHardInitRetryCount(client) {
  if (hardInitRetryCounts.has(client)) {
    hardInitRetryCounts.set(client, 0);
  }
}

function hasChromeExecutable(client) {
  const executablePath =
    typeof client?.getPuppeteerExecutablePath === "function"
      ? client.getPuppeteerExecutablePath()
      : client?.puppeteerExecutablePath;
  if (!executablePath) {
    return false;
  }
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
    return true;
  } catch (err) {
    return false;
  }
}

function isFatalMissingChrome(client, err) {
  const hasMissingChromeError =
    err?.isMissingChromeError === true ||
    client?.fatalInitError?.type === "missing-chrome";
  if (!hasMissingChromeError) {
    return false;
  }
  if (hasChromeExecutable(client)) {
    if (client?.fatalInitError?.type === "missing-chrome") {
      client.fatalInitError = null;
    }
    return false;
  }
  return true;
}

const missingChromeRemediationHint =
  "Set WA_PUPPETEER_EXECUTABLE_PATH or run `npx puppeteer browsers install chrome`.";

function isDisconnectChangeState(state) {
  const normalizedState = String(state || "").trim().toUpperCase();
  if (!normalizedState) {
    return false;
  }
  return disconnectChangeStates.has(normalizedState);
}

function reconnectClient(client, options = {}) {
  resetFallbackReadyState(client);
  return client.connect(options);
}

function reinitializeClient(client, options = {}) {
  resetFallbackReadyState(client);
  return client.reinitialize(options);
}

function scheduleHardInitRetry(client, label, err) {
  setClientNotReady(client);
  clearAuthenticatedFallbackTimer(client);
  if (isFatalMissingChrome(client, err)) {
    console.error(
      `[${label}] Missing Chrome executable; skipping hard init retries until Chrome is installed.`
    );
    return;
  }
  const currentAttempts = hardInitRetryCounts.get(client) || 0;
  if (currentAttempts >= maxHardInitRetries) {
    console.error(
      `[${label}] Hard init failure; aborting after ${currentAttempts} attempt(s): ${err?.message}`
    );
    return;
  }
  const nextAttempt = currentAttempts + 1;
  hardInitRetryCounts.set(client, nextAttempt);
  const delayMs = getHardInitRetryDelayMs(nextAttempt);
  console.warn(
    `[${label}] Hard init failure; scheduling reinit attempt ${nextAttempt}/${maxHardInitRetries} in ${delayMs}ms`
  );
  setTimeout(async () => {
    const connectPromise =
      typeof client?.getConnectPromise === "function"
        ? client.getConnectPromise()
        : null;
    if (connectPromise) {
      console.warn(
        `[${label}] Hard init retry ${nextAttempt} waiting for in-flight connect.`
      );
      try {
        await connectPromise;
        resetHardInitRetryCount(client);
        return;
      } catch (retryErr) {
        console.error(
          `[${label}] In-flight connect failed before hard init retry ${nextAttempt}: ${retryErr?.message}`
        );
        scheduleHardInitRetry(client, label, retryErr);
        return;
      }
    }
    reconnectClient(client)
      .then(() => {
        resetHardInitRetryCount(client);
      })
      .catch((retryErr) => {
        console.error(
          `[${label}] Hard init retry ${nextAttempt} failed: ${retryErr?.message}`
        );
        scheduleHardInitRetry(client, label, retryErr);
      });
  }, delayMs);
}

function markClientReady(client, src = "unknown") {
  clearAuthenticatedFallbackTimer(client);
  clearLogoutAwaitingQr(client);
  const state = getClientReadinessState(client);
  if (!state.ready) {
    state.ready = true;
    console.log(`[${state.label}] READY via ${src}`);
    state.readyResolvers.splice(0).forEach((resolve) => resolve());
  }
  if (state.lastAuthFailureAt) {
    state.lastAuthFailureAt = null;
    state.lastAuthFailureMessage = null;
  }
  resetHardInitRetryCount(client);
  // Note: flushPendingMessages removed - message reception disabled
  if (client === waClient) {
    flushAdminNotificationQueue();
  }
}

registerClientReadiness(waClient, "WA");

function handleClientDisconnect(client, label, reason) {
  setClientNotReady(client);
  clearAuthenticatedFallbackTimer(client);
  const normalizedReason = normalizeDisconnectReason(reason);
  const shouldAwaitQr = isLogoutDisconnectReason(normalizedReason);
  const state = getClientReadinessState(client);
  state.lastDisconnectReason = normalizedReason || null;
  state.awaitingQrScan = shouldAwaitQr;
  console.warn(`[${label}] Client disconnected:`, reason);
  if (shouldAwaitQr) {
    console.warn(
      `[${label}] Disconnect reason=${normalizedReason}; waiting for QR scan before reconnect.`
    );
    return;
  }
  setTimeout(async () => {
    const connectPromise =
      typeof client?.getConnectPromise === "function"
        ? client.getConnectPromise()
        : null;
    if (connectPromise) {
      console.warn(`[${label}] Reconnect skipped; connect already in progress.`);
      try {
        await connectPromise;
      } catch (err) {
        console.error(
          `[${label}] In-flight connect failed after disconnect:`,
          err?.message || err
        );
      }
      return;
    }
    reconnectClient(client).catch((err) => {
      console.error(`[${label}] Reconnect failed:`, err.message);
    });
  }, 5000);
}

waClient.on("disconnected", (reason) => {
  handleClientDisconnect(waClient, "WA", reason);
});

export function queueAdminNotification(message) {
  adminNotificationQueue.push(message);
}

export function flushAdminNotificationQueue() {
  if (!adminNotificationQueue.length) return;
  console.log(
    `[WA] Sending ${adminNotificationQueue.length} queued admin notification(s)`
  );
  adminNotificationQueue.splice(0).forEach((msg) => {
    for (const wa of getAdminWAIds()) {
      safeSendMessage(waClient, wa, msg);
    }
  });
}

async function waitForClientReady(client, timeoutMs) {
  const state = getClientReadinessState(client);
  if (state.ready) return;
  if (await inferClientReadyState(client, state.label, "pre-wait")) return;

  const formatClientReadyTimeoutContext = (readinessState) => {
    const label = readinessState?.label || "WA";
    const clientId = client?.clientId || "unknown";
    const sessionPath = client?.sessionPath || "unknown";
    const awaitingQrScan = readinessState?.awaitingQrScan ? "true" : "false";
    const lastDisconnectReason = readinessState?.lastDisconnectReason || "none";
    const lastAuthFailureAt = readinessState?.lastAuthFailureAt
      ? new Date(readinessState.lastAuthFailureAt).toISOString()
      : "none";
    return {
      label,
      clientId,
      sessionPath,
      awaitingQrScan,
      lastDisconnectReason,
      lastAuthFailureAt,
    };
  };

  return new Promise((resolve, reject) => {
    let timer;
    const resolver = () => {
      clearTimeout(timer);
      resolve();
    };
    state.readyResolvers.push(resolver);
    const resolvedTimeoutMs =
      timeoutMs === null || timeoutMs === undefined
        ? getClientReadyTimeoutMs(client)
        : Number.isNaN(Number(timeoutMs))
          ? getClientReadyTimeoutMs(client)
          : Number(timeoutMs);
    if (isFatalMissingChrome(client) || client?.fatalInitError?.type === "missing-chrome") {
      const idx = state.readyResolvers.indexOf(resolver);
      if (idx !== -1) state.readyResolvers.splice(idx, 1);
      const timeoutContext = formatClientReadyTimeoutContext(state);
      timeoutContext.remediationHint = missingChromeRemediationHint;
      const contextMessage =
        `label=${timeoutContext.label} ` +
        `clientId=${timeoutContext.clientId} ` +
        `sessionPath=${timeoutContext.sessionPath} ` +
        `awaitingQrScan=${timeoutContext.awaitingQrScan} ` +
        `lastDisconnectReason=${timeoutContext.lastDisconnectReason} ` +
        `lastAuthFailureAt=${timeoutContext.lastAuthFailureAt}`;
      const missingChromeError = new Error(
        `WhatsApp client not ready: missing Chrome executable; ${contextMessage}. ${missingChromeRemediationHint}`
      );
      missingChromeError.context = timeoutContext;
      reject(missingChromeError);
      return;
    }
    timer = setTimeout(async () => {
      if (await inferClientReadyState(client, state.label, "timeout-check")) {
        return;
      }
      const idx = state.readyResolvers.indexOf(resolver);
      if (idx !== -1) state.readyResolvers.splice(idx, 1);
      const timeoutContext = formatClientReadyTimeoutContext(state);
      const missingChrome = isFatalMissingChrome(client);
      const contextMessage =
        `label=${timeoutContext.label} ` +
        `clientId=${timeoutContext.clientId} ` +
        `sessionPath=${timeoutContext.sessionPath} ` +
        `awaitingQrScan=${timeoutContext.awaitingQrScan} ` +
        `lastDisconnectReason=${timeoutContext.lastDisconnectReason} ` +
        `lastAuthFailureAt=${timeoutContext.lastAuthFailureAt}`;
      const remediationMessage =
        "Remediation: scan QR terbaru (jika awaitingQrScan=true), cek WA_AUTH_DATA_PATH, WA_PUPPETEER_EXECUTABLE_PATH.";
      console.error(
        `[${timeoutContext.label}] waitForClientReady timeout after ${resolvedTimeoutMs}ms; ${contextMessage}; ${remediationMessage}`
      );
      const waState = getClientReadinessState(waClient, "WA");
      if (waState.ready) {
        queueAdminNotification(
          `[${timeoutContext.label}] WA client not ready after ${resolvedTimeoutMs}ms. ${remediationMessage}`
        );
        flushAdminNotificationQueue();
      }
      if (missingChrome) {
        timeoutContext.remediationHint = missingChromeRemediationHint;
        const missingChromeError = new Error(
          `WhatsApp client not ready: missing Chrome executable; ${contextMessage}. ${missingChromeRemediationHint}`
        );
        missingChromeError.context = timeoutContext;
        reject(missingChromeError);
        return;
      }
      const timeoutError = new Error(
        `WhatsApp client not ready after ${resolvedTimeoutMs}ms; ${contextMessage}`
      );
      timeoutError.context = timeoutContext;
      reject(timeoutError);
    }, resolvedTimeoutMs);
  });
}

export function waitForWaReady(timeoutMs) {
  return waitForClientReady(waClient, timeoutMs);
}

// Expose readiness helper for consumers like safeSendMessage
waClient.waitForWaReady = () => waitForClientReady(waClient);

// Pastikan semua pengiriman pesan menunggu hingga client siap
function wrapSendMessage(client) {
  const original = client.sendMessage;
  client._originalSendMessage = original;
  let queueForClient = messageQueues.get(client);
  if (!queueForClient) {
    queueForClient = new PQueue({ concurrency: 1 });
    messageQueues.set(client, queueForClient);
  }

  async function sendWithRetry(args, attempt = 0) {
    const waitFn =
      typeof client.waitForWaReady === "function"
        ? client.waitForWaReady
        : () => waitForClientReady(client);

    await waitFn().catch(() => {
      console.warn("[WA] sendMessage called before ready");
      throw new Error("WhatsApp client not ready");
    });
    try {
      return await original.apply(client, args);
    } catch (err) {
      const isRateLimit = err?.data === 429 || err?.message === "rate-overlimit";
      if (!isRateLimit || attempt >= 4) throw err;
      const baseDelay = 2 ** attempt * 800;
      const jitter = Math.floor(Math.random() * 0.2 * baseDelay);
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      return sendWithRetry(args, attempt + 1);
    }
  }

  client.sendMessage = (...args) => {
    return queueForClient.add(() => sendWithRetry(args), {
      delay: responseDelayMs,
    });
  };
}
wrapSendMessage(waClient);

/**
 * Wait for all WhatsApp client message queues to be idle (empty and no pending tasks)
 * This ensures all messages have been sent before the caller continues
 */
export async function waitForAllMessageQueues() {
  const clients = [waClient];
  const idlePromises = [];
  
  for (const client of clients) {
    const queue = messageQueues.get(client);
    if (queue) {
      idlePromises.push(queue.onIdle());
    }
  }
  
  if (idlePromises.length > 0) {
    await Promise.all(idlePromises);
  }
}

export function sendGatewayMessage(jid, text) {
  const waFallbackClients = [
    { client: waClient, label: "WA" },
  ];
  return sendWithClientFallback({
    chatId: jid,
    message: text,
    clients: waFallbackClients,
    reportClient: waClient,
    reportContext: { source: "sendGatewayMessage", jid },
  });
}

// Handle QR code (scan)
waClient.on("qr", (qr) => {
  resetFallbackReadyState(waClient);
  const state = getClientReadinessState(waClient, "WA");
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;
  qrcode.generate(qr, { small: true });
  console.log("[WA] Scan QR dengan WhatsApp Anda!");
});

waClient.on("authenticated", (session) => {
  const sessionInfo = session ? "session received" : "no session payload";
  console.log(`[WA] Authenticated (${sessionInfo}); menunggu ready.`);
  resetFallbackReadyState(waClient);
  clearLogoutAwaitingQr(waClient);
  scheduleAuthenticatedReadyFallback(waClient, "WA");
});

waClient.on("auth_failure", (message) => {
  clearAuthenticatedFallbackTimer(waClient);
  setClientNotReady(waClient);
  const state = getClientReadinessState(waClient, "WA");
  state.lastAuthFailureAt = Date.now();
  state.lastAuthFailureMessage = message || null;
  console.error(`[WA] Auth failure: ${message}`);
});

// Wa Bot siap
waClient.on("ready", () => {
  clearAuthenticatedFallbackTimer(waClient);
  clearLogoutAwaitingQr(waClient);
  markClientReady(waClient, "ready");
});

// Log client state changes if available
waClient.on("change_state", (state) => {
  console.log(`[WA] Client state changed: ${state}`);
  if (state === "CONNECTED" || state === "open") {
    clearAuthenticatedFallbackTimer(waClient);
    clearLogoutAwaitingQr(waClient);
    markClientReady(waClient, "state");
  } else if (isDisconnectChangeState(state)) {
    setClientNotReady(waClient);
  }
});

// =======================
// MESSAGE HANDLER UTAMA
// =======================
async function handleClientRequestSessionStep({
  session,
  chatId,
  text,
  waClient,
  clientLabel,
  pool,
  userModel,
  clientService,
  migrateUsersFromFolder,
  checkGoogleSheetCsvStatus,
  importUsersFromGoogleSheet,
  fetchAndStoreInstaContent,
  fetchAndStoreTiktokContent,
  formatClientData,
  handleFetchLikesInstagram,
  handleFetchKomentarTiktokBatch,
}) {
  if (!session || session.menu !== "clientrequest") {
    return false;
  }

  if ((text || "").toLowerCase() === "batal") {
    clearSession(chatId);
    await safeSendMessage(waClient, chatId, "✅ Menu Client ditutup.");
    return true;
  }

  await runMenuHandler({
    handlers: clientRequestHandlers,
    menuName: "clientrequest",
    session,
    chatId,
    text,
    waClient,
    clientLabel,
    args: [
      pool,
      userModel,
      clientService,
      migrateUsersFromFolder,
      checkGoogleSheetCsvStatus,
      importUsersFromGoogleSheet,
      fetchAndStoreInstaContent,
      fetchAndStoreTiktokContent,
      formatClientData,
      handleFetchLikesInstagram,
      handleFetchKomentarTiktokBatch,
    ],
    invalidStepMessage:
      "⚠️ Sesi menu client tidak dikenali. Ketik *clientrequest* ulang atau *batal*.",
    failureMessage:
      "❌ Terjadi kesalahan pada menu client. Ketik *clientrequest* ulang untuk memulai kembali.",
  });

  return true;
}


if (shouldInitWhatsAppClients) {
  console.log('[WA] Initializing WhatsApp client in SEND-ONLY mode (message reception disabled)...');
  
  const clientsToInit = [
    { label: "WA", client: waClient },
  ];

  const initPromises = clientsToInit.map(({ label, client }) => {
    console.log(`[${label}] Starting WhatsApp client initialization`);
    return reconnectClient(client)
      .then(() => {
        resetHardInitRetryCount(client);
      })
      .catch((err) => {
        console.error(`[${label}] Initialization failed (hard failure):`, err?.message);
        scheduleHardInitRetry(client, label, err);
      });
  });

  const scheduleFallbackReadyCheck = (
    client,
    delayMs = fallbackReadyCheckDelayMs
  ) => {
    const readinessState = getClientReadinessState(client);
    if (readinessState.fallbackCheckCompleted) {
      return;
    }
    if (readinessState.fallbackCheckInFlight) {
      return;
    }
    readinessState.fallbackCheckInFlight = true;
    const isConnectInFlight = () =>
      typeof client?.getConnectPromise === "function" &&
      Boolean(client.getConnectPromise());
    const getConnectInFlightDurationMs = () => {
      if (typeof client?.getConnectStartedAt !== "function") {
        return null;
      }
      const startedAt = client.getConnectStartedAt();
      if (!startedAt) {
        return null;
      }
      const durationMs = Date.now() - startedAt;
      return durationMs >= 0 ? durationMs : null;
    };
    const formatFallbackReadyContext = (
      readinessState,
      connectInFlight,
      connectInFlightDurationMs = null
    ) => {
      const clientId = client?.clientId || "unknown";
      const sessionPath = client?.sessionPath || "unknown";
      const awaitingQrScan = readinessState?.awaitingQrScan ? "true" : "false";
      const lastDisconnectReason = readinessState?.lastDisconnectReason || "none";
      const lastAuthFailureAt = readinessState?.lastAuthFailureAt
        ? new Date(readinessState.lastAuthFailureAt).toISOString()
        : "none";
      const lastQrAt = readinessState?.lastQrAt
        ? new Date(readinessState.lastQrAt).toISOString()
        : "none";
      const connectInFlightLabel = connectInFlight ? "true" : "false";
      const connectInFlightDuration =
        connectInFlightDurationMs !== null
          ? formatConnectDurationMs(connectInFlightDurationMs)
          : "n/a";
      return (
        `clientId=${clientId} ` +
        `connectInFlight=${connectInFlightLabel} ` +
        `connectInFlightDuration=${connectInFlightDuration} ` +
        `awaitingQrScan=${awaitingQrScan} ` +
        `lastDisconnectReason=${lastDisconnectReason} ` +
        `lastAuthFailureAt=${lastAuthFailureAt} ` +
        `lastQrAt=${lastQrAt} ` +
        `sessionPath=${sessionPath}`
      );
    };
    const scheduleFallbackCooldown = (cooldownMs) => {
      setTimeout(() => {
        fallbackReinitCounts.set(client, 0);
        fallbackStateRetryCounts.set(client, 0);
        const readinessState = getClientReadinessState(client);
        readinessState.unknownStateRetryCount = 0;
        scheduleFallbackReadyCheck(client, delayMs);
      }, cooldownMs);
    };
    setTimeout(async () => {
      const state = getClientReadinessState(client);
      state.fallbackCheckInFlight = false;
      if (state.fallbackCheckCompleted) {
        return;
      }
      if (state.ready) {
        markFallbackCheckCompleted(client);
        return;
      }
      const { label } = state;
      const connectInFlightDurationMs = getConnectInFlightDurationMs();
      if (isConnectInFlight()) {
        if (
          connectInFlightDurationMs !== null &&
          connectInFlightDurationMs >= connectInFlightWarnMs
        ) {
          console.warn(
            `[${label}] connect in progress for ${formatConnectDurationMs(
              connectInFlightDurationMs
            )}; ${formatFallbackReadyContext(
              state,
              true,
              connectInFlightDurationMs
            )}`
          );
        }
        if (
          connectInFlightDurationMs !== null &&
          connectInFlightDurationMs >= connectInFlightReinitMs
        ) {
          if (state.awaitingQrScan && hasRecentQrScan(state)) {
            console.warn(
              `[${label}] QR baru muncul; reinit ditunda; ${formatFallbackReadyContext(
                state,
                true,
                connectInFlightDurationMs
              )}`
            );
            scheduleFallbackReadyCheck(client, delayMs);
            return;
          }
          if (typeof client?.reinitialize === "function") {
            console.warn(
              `[${label}] connect in progress for ${formatConnectDurationMs(
                connectInFlightDurationMs
              )}; triggering reinit.`
            );
            reinitializeClient(client, {
                trigger: "connect-inflight-timeout",
                reason: `connect in progress for ${formatConnectDurationMs(
                  connectInFlightDurationMs
                )}`,
              })
              .catch((err) => {
                console.error(
                  `[${label}] Reinit failed after connect in-flight timeout: ${err?.message}`
                );
              });
          } else {
            console.warn(
              `[${label}] connect in progress for ${formatConnectDurationMs(
                connectInFlightDurationMs
              )}; reinit unavailable.`
            );
          }
          scheduleFallbackReadyCheck(client, delayMs);
          return;
        }
        console.log(
          `[${label}] fallback readiness skipped; connect in progress; ${formatFallbackReadyContext(
            state,
            true,
            connectInFlightDurationMs
          )}`
        );
        scheduleFallbackReadyCheck(client, delayMs);
        return;
      }
      if (isFatalMissingChrome(client)) {
        console.warn(
          `[${label}] Missing Chrome executable; skipping fallback readiness until Chrome is installed.`
        );
        return;
      }
      if (state.awaitingQrScan) {
        const reasonLabel = state.lastDisconnectReason || "LOGOUT";
        console.warn(
          `[${label}] Awaiting QR scan after ${reasonLabel}; skipping fallback readiness`
        );
        scheduleFallbackReadyCheck(client, delayMs);
        return;
      }
      if (typeof client?.isReady === "function") {
        try {
          const isReady = (await client.isReady()) === true;
          if (isReady) {
            console.log(
              `[${label}] fallback isReady indicates ready; awaiting ready event`
            );
            fallbackStateRetryCounts.set(client, 0);
            fallbackReinitCounts.set(client, 0);
            state.unknownStateRetryCount = 0;
            markFallbackCheckCompleted(client);
            return;
          }
          if (client?.info !== undefined) {
            console.warn(
              `[${label}] fallback readiness deferred; isReady=false while client.info is present`
            );
          }
        } catch (error) {
          console.warn(
            `[${label}] fallback isReady check failed: ${error?.message}`
          );
          if (client?.info !== undefined) {
            console.warn(
              `[${label}] fallback readiness deferred; client.info present but isReady errored`
            );
          }
        }
      } else if (client?.info !== undefined) {
        console.warn(
          `[${label}] fallback readiness deferred; client.info present but isReady not available`
        );
      }
      if (typeof client?.getState !== "function") {
        console.log(
          `[${label}] getState not available for fallback readiness; deferring readiness`
        );
        scheduleFallbackReadyCheck(client, delayMs);
        return;
      }
      try {
        const currentState = await client.getState();
        const normalizedState =
          currentState === null || currentState === undefined
            ? "unknown"
            : currentState;
        const normalizedStateLower =
          normalizedState === "unknown"
            ? "unknown"
            : String(normalizedState).toLowerCase();
        console.log(`[${label}] getState: ${normalizedState}`);
        if (normalizedStateLower === "unknown") {
          console.warn(
            `[${label}] fallback getState unknown; ${formatFallbackReadyContext(
              state,
              isConnectInFlight(),
              getConnectInFlightDurationMs()
            )}`
          );
        }
        if (
          normalizedStateLower === "connected" ||
          normalizedStateLower === "open"
        ) {
          fallbackStateRetryCounts.set(client, 0);
          fallbackReinitCounts.set(client, 0);
          state.unknownStateRetryCount = 0;
          console.log(
            `[${label}] getState=${normalizedState}; awaiting ready event`
          );
          markFallbackCheckCompleted(client);
          return;
        }

        const currentRetryCount = fallbackStateRetryCounts.get(client) || 0;
        if (currentRetryCount < maxFallbackStateRetries) {
          const nextRetryCount = currentRetryCount + 1;
          fallbackStateRetryCounts.set(client, nextRetryCount);
          const retryDelayMs = getFallbackStateRetryDelayMs();
          console.warn(
            `[${label}] getState=${normalizedState}; retrying ` +
              `(${nextRetryCount}/${maxFallbackStateRetries}) in ${retryDelayMs}ms; ` +
              formatFallbackReadyContext(
                state,
                isConnectInFlight(),
                getConnectInFlightDurationMs()
              )
          );
          scheduleFallbackReadyCheck(client, retryDelayMs);
          return;
        }

        fallbackStateRetryCounts.set(client, 0);
        const reinitAttempts = fallbackReinitCounts.get(client) || 0;
        if (reinitAttempts >= maxFallbackReinitAttempts) {
          console.warn(
            `[${label}] getState=${normalizedState} after retries; reinit skipped ` +
              `(max ${maxFallbackReinitAttempts} attempts); cooldown ` +
              `${fallbackReadyCooldownMs}ms before retrying fallback checks`
          );
          scheduleFallbackCooldown(fallbackReadyCooldownMs);
          return;
        }
        fallbackReinitCounts.set(client, reinitAttempts + 1);
        if (normalizedStateLower !== "unknown") {
          state.unknownStateRetryCount = 0;
        }
        const unknownStateRetryCount = normalizedStateLower === "unknown"
          ? (state.unknownStateRetryCount || 0) + 1
          : 0;
        if (normalizedStateLower === "unknown") {
          state.unknownStateRetryCount = unknownStateRetryCount;
        }
        const shouldEscalateUnknownState =
          normalizedStateLower === "unknown" &&
          label === "WA" &&
          unknownStateRetryCount >= maxUnknownStateEscalationRetries;
        const shouldClearFallbackSession =
          normalizedStateLower === "unknown" &&
          (label === "WA" || label === "WA-USER");
        const hasAuthIndicators = hasAuthFailureIndicator(state);
        const sessionPath = client?.sessionPath || null;
        const sessionPathExists = sessionPath ? fs.existsSync(sessionPath) : false;
        const hasSessionContent =
          sessionPathExists && hasPersistedAuthSession(sessionPath);
        const shouldClearCloseSession =
          normalizedStateLower === "close" &&
          label === "WA" &&
          hasSessionContent;
        const canClearFallbackSession =
          sessionPathExists &&
          ((shouldClearFallbackSession && hasAuthIndicators) ||
            shouldClearCloseSession);
        if (
          shouldEscalateUnknownState &&
          sessionPathExists &&
          typeof client?.reinitialize === "function"
        ) {
          state.lastAuthFailureAt = Date.now();
          state.lastAuthFailureMessage = "fallback-unknown-escalation";
          console.warn(
            `[${label}] getState=${normalizedState} after retries; ` +
              `escalating unknown-state retries (${unknownStateRetryCount}/${maxUnknownStateEscalationRetries}); ` +
              `reinitializing with clear session; ` +
              formatFallbackReadyContext(
                state,
                isConnectInFlight(),
                getConnectInFlightDurationMs()
              )
          );
          reinitializeClient(client, {
              clearAuthSession: true,
              trigger: "fallback-unknown-escalation",
              reason: `unknown state after ${unknownStateRetryCount} retry cycles`,
            })
            .catch((err) => {
              console.error(
                `[${label}] Reinit failed after fallback getState=${normalizedState}: ${err?.message}`
              );
            });
          scheduleFallbackReadyCheck(client, delayMs);
          return;
        }
        if (canClearFallbackSession && typeof client?.reinitialize === "function") {
          const clearReason =
            shouldClearCloseSession && !hasAuthIndicators
              ? "getState close with persisted session"
              : "getState unknown with auth indicator";
          console.warn(
            `[${label}] getState=${normalizedState} after retries; ` +
              `reinitializing with clear session (${reinitAttempts + 1}/${maxFallbackReinitAttempts}); ` +
              formatFallbackReadyContext(
                state,
                isConnectInFlight(),
                getConnectInFlightDurationMs()
              )
          );
          reinitializeClient(client, {
              clearAuthSession: true,
              trigger: "fallback-unknown-auth",
              reason: clearReason,
            })
            .catch((err) => {
              console.error(
                `[${label}] Reinit failed after fallback getState=${normalizedState}: ${err?.message}`
              );
            });
          scheduleFallbackReadyCheck(client, delayMs);
          return;
        }
        if (
          (shouldClearFallbackSession || shouldClearCloseSession) &&
          !canClearFallbackSession
        ) {
          const skipReason = shouldClearCloseSession
            ? "session path missing"
            : !hasAuthIndicators
            ? "no auth indicator"
            : "session path missing";
          console.warn(
            `[${label}] getState=${normalizedState} after retries; ` +
              `skip clear session (${skipReason}); ` +
              formatFallbackReadyContext(
                state,
                isConnectInFlight(),
                getConnectInFlightDurationMs()
              )
          );
        }
        if (typeof client?.connect === "function") {
          console.warn(
            `[${label}] getState=${normalizedState} after retries; reinitializing (${reinitAttempts + 1}/${maxFallbackReinitAttempts})`
          );
          reconnectClient(client).catch((err) => {
            console.error(
              `[${label}] Reinit failed after fallback getState=${normalizedState}: ${err?.message}`
            );
          });
          scheduleFallbackReadyCheck(client, delayMs);
        } else {
          console.warn(
            `[${label}] connect not available; unable to reinit after fallback getState=${normalizedState}`
          );
        }
      } catch (e) {
        console.log(`[${label}] getState error: ${e?.message}`);
        console.warn(`[${label}] fallback readiness deferred after getState error`);
        scheduleFallbackReadyCheck(client, delayMs);
      }
    }, delayMs);
  };

  scheduleFallbackReadyCheck(waClient);

  await Promise.allSettled(initPromises);

  // In production, ensure client is ready for sending messages
  const shouldFailFastOnInit = process.env.NODE_ENV === "production";
  if (shouldFailFastOnInit) {
    const initIssues = clientsToInit
      .map((clientEntry) => getInitReadinessIssue(clientEntry))
      .filter(Boolean);
    if (initIssues.length > 0) {
      initIssues.forEach((issue) => {
        console.error(
          `[WA] ${issue.label} init issue: ${issue.reason}. Remediation: ${issue.remediation}`
        );
      });
      const summary = initIssues
        .map(
          (issue) => `${issue.label}:${issue.reason}${issue.detail ? ` (${issue.detail})` : ""}`
        )
        .join("; ");
      throw new Error(
        `[WA] WhatsApp client not ready for sending messages. ${summary}`
      );
    }
  }

  // Diagnostic checks for client readiness
  logWaServiceDiagnostics(
    waClient,
    getWaReadinessSummary()
  );
  console.log('[WA] WhatsApp client initialized for send-only mode (message reception disabled).');
}

// =======================
// ADMIN COMMAND HANDLER
// =======================
async function handleAdminCommands(from, body) {
  const trimmedBody = body.trim().toLowerCase();
  
  // Check for approvedash# command
  if (trimmedBody.startsWith('approvedash#')) {
    const username = trimmedBody.substring('approvedash#'.length).trim();
    if (!username) {
      await safeSendMessage(waClient, from, '❌ Format salah. Gunakan: approvedash#username');
      return true;
    }
    
    try {
      // Find user by username
      const user = await dashboardUserModel.findByUsername(username);
      if (!user) {
        await safeSendMessage(waClient, from, `❌ User dengan username "${username}" tidak ditemukan.`);
        return true;
      }
      
      if (user.status) {
        await safeSendMessage(waClient, from, `✅ User "${username}" sudah disetujui sebelumnya.`);
        return true;
      }
      
      // Approve user
      await dashboardUserModel.updateStatus(user.dashboard_user_id, true);
      
      // Send notification to user via WhatsApp if available
      let userNotified = false;
      let userNotificationError = null;
      if (user.whatsapp) {
        try {
          const wid = formatToWhatsAppId(user.whatsapp);
          const sent = await safeSendMessage(
            waClient,
            wid,
            `✅ Registrasi dashboard Anda telah disetujui.\nUsername: ${user.username}`
          );
          userNotified = sent !== false;
          if (!userNotified) {
            userNotificationError = 'WhatsApp message send returned false';
          }
        } catch (err) {
          console.error(`[WA] Failed to notify user ${username}:`, err.message);
          userNotificationError = err.message;
        }
      }
      
      // Send confirmation to admin with notification status
      let confirmationMessage = `✅ User "${username}" berhasil disetujui.`;
      if (user.whatsapp) {
        if (userNotified) {
          confirmationMessage += `\n✅ Notifikasi telah dikirim ke ${user.whatsapp}`;
        } else {
          confirmationMessage += `\n⚠️ Notifikasi ke ${user.whatsapp} gagal dikirim`;
          if (userNotificationError) {
            confirmationMessage += `\nAlasan: ${userNotificationError}`;
          }
        }
      } else {
        confirmationMessage += `\n⚠️ User tidak memiliki nomor WhatsApp terdaftar`;
      }
      
      await safeSendMessage(waClient, from, confirmationMessage);
      
      return true;
    } catch (err) {
      console.error('[WA] Error handling approvedash command:', err);
      await safeSendMessage(waClient, from, `❌ Terjadi kesalahan: ${err.message}`);
      return true;
    }
  }
  
  // Check for denydash# command
  if (trimmedBody.startsWith('denydash#')) {
    const username = trimmedBody.substring('denydash#'.length).trim();
    if (!username) {
      await safeSendMessage(waClient, from, '❌ Format salah. Gunakan: denydash#username');
      return true;
    }
    
    try {
      // Find user by username
      const user = await dashboardUserModel.findByUsername(username);
      if (!user) {
        await safeSendMessage(waClient, from, `❌ User dengan username "${username}" tidak ditemukan.`);
        return true;
      }
      
      if (!user.status) {
        await safeSendMessage(waClient, from, `✅ User "${username}" sudah ditolak sebelumnya.`);
        return true;
      }
      
      // Deny user
      await dashboardUserModel.updateStatus(user.dashboard_user_id, false);
      
      // Send notification to user via WhatsApp if available
      let userNotified = false;
      let userNotificationError = null;
      if (user.whatsapp) {
        try {
          const wid = formatToWhatsAppId(user.whatsapp);
          const sent = await safeSendMessage(
            waClient,
            wid,
            `❌ Registrasi dashboard Anda ditolak.\nUsername: ${user.username}`
          );
          userNotified = sent !== false;
          if (!userNotified) {
            userNotificationError = 'WhatsApp message send returned false';
          }
        } catch (err) {
          console.error(`[WA] Failed to notify user ${username}:`, err.message);
          userNotificationError = err.message;
        }
      }
      
      // Send confirmation to admin with notification status
      let confirmationMessage = `✅ User "${username}" berhasil ditolak.`;
      if (user.whatsapp) {
        if (userNotified) {
          confirmationMessage += `\n✅ Notifikasi telah dikirim ke ${user.whatsapp}`;
        } else {
          confirmationMessage += `\n⚠️ Notifikasi ke ${user.whatsapp} gagal dikirim`;
          if (userNotificationError) {
            confirmationMessage += `\nAlasan: ${userNotificationError}`;
          }
        }
      } else {
        confirmationMessage += `\n⚠️ User tidak memiliki nomor WhatsApp terdaftar`;
      }
      
      await safeSendMessage(waClient, from, confirmationMessage);
      
      return true;
    } catch (err) {
      console.error('[WA] Error handling denydash command:', err);
      await safeSendMessage(waClient, from, `❌ Terjadi kesalahan: ${err.message}`);
      return true;
    }
  }
  
  return false;
}

// Add message listener for admin commands only
if (shouldInitWhatsAppClients) {
  console.log('[WA] Attaching message listener for admin commands...');
  
  waClient.on('message', async (msg) => {
    try {
      const from = msg.from || msg.author;
      const body = msg.body || '';
      
      if (!from || !body) {
        return;
      }
      
      // Only process admin commands
      const trimmedBody = body.trim().toLowerCase();
      if (trimmedBody.startsWith('approvedash#') || trimmedBody.startsWith('denydash#')) {
        await handleAdminCommands(from, body);
      }
    } catch (err) {
      console.error('[WA] Error in message handler:', err);
    }
  });
}

export default waClient;

// ======================= end of file ======================
