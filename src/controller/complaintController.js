// src/controller/complaintController.js
import * as userModel from "../model/userModel.js";
import { sendSuccess } from "../utils/response.js";
import {
  formatComplaintIssue,
  formatNama,
  getGreeting,
  normalizeUserId,
} from "../utils/utilsHelper.js";
import {
  UPDATE_DATA_LINK,
  buildAccountStatus,
  buildComplaintSolutionsFromIssues,
  buildUpdateDataInstructions,
  normalizeComplaintHandle,
  parseComplaintMessage,
  sendComplaintWhatsappResponse,
} from "../service/complaintService.js";

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isUserActive(user) {
  if (!user) return false;
  const { status } = user;
  if (status === null || status === undefined) {
    return true;
  }
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    return ["true", "1", "aktif"].includes(normalized);
  }
  if (typeof status === "number") {
    return status === 1;
  }
  return Boolean(status);
}

function resolveComplaintSource(body) {
  return (
    normalizeText(body.message) ||
    normalizeText(body.pesan) ||
    normalizeText(body.complaint) ||
    normalizeText(body.raw) ||
    normalizeText(body.text) ||
    ""
  );
}

function normalizeClientId(value) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function isClientAuthorized(clientIdFromToken, targetClientId) {
  if (!clientIdFromToken) return false;
  return (
    normalizeClientId(clientIdFromToken) === normalizeClientId(targetClientId)
  );
}

function resolveComplaintHandles(body) {
  const instagram =
    normalizeComplaintHandle(body.instagram) ||
    normalizeComplaintHandle(body.insta) ||
    normalizeComplaintHandle(body.username_ig) ||
    normalizeComplaintHandle(body.username_instagram);
  const tiktok =
    normalizeComplaintHandle(body.tiktok) ||
    normalizeComplaintHandle(body.username_tiktok);
  return { instagram: instagram || "", tiktok: tiktok || "" };
}

function resolveIssueText(body, platformLabel) {
  const issue =
    normalizeText(body.issue) ||
    normalizeText(body.kendala) ||
    normalizeText(body.problem);
  if (issue) return issue;
  return `Belum ada rincian kendala untuk komplain ${platformLabel}.`;
}

function resolveSolutionText(body, platformLabel) {
  const solution =
    normalizeText(body.solution) ||
    normalizeText(body.solusi) ||
    normalizeText(body.tindak_lanjut);
  if (solution) return solution;
  return [
    `Tim kami sedang menindaklanjuti laporan ${platformLabel}.`,
    "Jika diperlukan, kami akan menghubungi kembali setelah pengecekan.",
  ].join(" ");
}

function buildFormattedComplaintIssue({ parsedComplaint, nrp, fallbackIssue }) {
  const complaintIssues = Array.isArray(parsedComplaint?.issues)
    ? parsedComplaint.issues.filter((issue) => issue && issue.trim())
    : [];

  if (complaintIssues.length) {
    return formatComplaintIssue(
      [
        "Pesan Komplain",
        `NRP/NIP: ${parsedComplaint?.nrp || nrp || "-"}`,
        parsedComplaint?.name ? `Nama: ${parsedComplaint.name}` : "",
        parsedComplaint?.polres ? `Polres: ${parsedComplaint.polres}` : "",
        parsedComplaint?.instagram ? `Instagram: ${parsedComplaint.instagram}` : "",
        parsedComplaint?.tiktok ? `TikTok: ${parsedComplaint.tiktok}` : "",
        "",
        "Kendala",
        ...complaintIssues.map((issue) => `- ${issue}`),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return formatComplaintIssue(parsedComplaint?.raw || fallbackIssue || "");
}

function buildComplaintMessage({ reporterName, nrp, issue, solution }) {
  const salam = getGreeting();
  return [
    `${salam}! Kami menindaklanjuti laporan yang Anda sampaikan.`,
    `\n*Pelapor*: ${reporterName}`,
    `\n*NRP/NIP*: ${nrp}`,
    `\n*Kendala*:`,
    issue,
    `\n\n*Solusi/Tindak Lanjut*:`,
    solution,
  ]
    .join("\n")
    .trim();
}

async function handleComplaint(req, res, platformLabel) {
  const rawNrp = req.body?.nrp;
  const nrp = normalizeUserId(rawNrp);
  if (!nrp) {
    return res
      .status(400)
      .json({ success: false, message: "nrp wajib diisi" });
  }

  const user = await userModel.findUserById(nrp);
  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: "User tidak ditemukan" });
  }

  const targetClientId = user.client_id;
  const clientIdFromToken = req.user?.client_id;
  // Dashboard users can handle complaints for any client
  // Only check authorization for regular client users
  if (!req.dashboardUser && clientIdFromToken) {
    if (!isClientAuthorized(clientIdFromToken, targetClientId)) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden" });
    }
  }

  const reporterName = formatNama(user) || user.nama || nrp;
  const complaintSource = resolveComplaintSource(req.body || {});
  const parsedComplaint = complaintSource
    ? parseComplaintMessage(complaintSource)
    : { raw: "", issues: [] };

  if (!parsedComplaint.nrp) {
    parsedComplaint.nrp = nrp;
  }

  if (!parsedComplaint.instagram || !parsedComplaint.tiktok) {
    const handles = resolveComplaintHandles(req.body || {});
    parsedComplaint.instagram = parsedComplaint.instagram || handles.instagram;
    parsedComplaint.tiktok = parsedComplaint.tiktok || handles.tiktok;
  }

  if (!Array.isArray(parsedComplaint.issues) || parsedComplaint.issues.length === 0) {
    const fallbackIssue = resolveIssueText(req.body || {}, platformLabel);
    parsedComplaint.issues = fallbackIssue ? [fallbackIssue] : [];
    parsedComplaint.raw = parsedComplaint.raw || fallbackIssue;
  }

  const formattedIssue = buildFormattedComplaintIssue({
    parsedComplaint,
    nrp,
    fallbackIssue: resolveIssueText(req.body || {}, platformLabel),
  });

  let issue = formattedIssue || resolveIssueText(req.body || {}, platformLabel);
  let solution = "";

  if (!isUserActive(user)) {
    issue = formattedIssue || "Akun personel tidak aktif.";
    solution = [
      "Akun Cicero personel saat ini *tidak aktif*.",
      "Mohon hubungi operator satker untuk melakukan aktivasi akun sebelum melanjutkan pelaporan tugas atau komplain.",
      "Setelah akun aktif, silakan informasikan kembali melalui menu *Client Request* bila kendala masih terjadi.",
    ].join("\n");
  } else {
    const accountStatus = await buildAccountStatus(user);
    const instaUsername =
      typeof user.insta === "string" ? user.insta.trim() : user.insta || "";
    const tiktokUsername =
      typeof user.tiktok === "string" ? user.tiktok.trim() : user.tiktok || "";
    const hasInsta = Boolean(instaUsername);
    const hasTiktok = Boolean(tiktokUsername);

    if (!hasInsta && !hasTiktok) {
      issue = "Akun sosial media masih belum terisi";
      solution = [
        "Belum terdapat username Instagram maupun TikTok pada data personel.",
        "",
        "Langkah tindak lanjut:",
        buildUpdateDataInstructions("Instagram dan TikTok"),
        "",
        `Tautan update data personel: ${UPDATE_DATA_LINK}`,
      ].join("\n");
    } else {
      const { solutionText } = await buildComplaintSolutionsFromIssues(
        parsedComplaint,
        user,
        accountStatus
      );
      solution = solutionText;
    }
  }

  if (!solution) {
    solution = resolveSolutionText(req.body || {}, platformLabel);
  }

  const message = buildComplaintMessage({ reporterName, nrp, issue, solution });
  const dashboardWhatsapp = req.dashboardUser?.whatsapp || null;
  const channel = user?.whatsapp
    ? "whatsapp"
    : user?.email
    ? "email"
    : "unknown";
  const whatsappDelivery = await sendComplaintWhatsappResponse({
    message,
    personnelWhatsapp: user?.whatsapp,
    dashboardWhatsapp,
  });

  sendSuccess(res, {
    platform: platformLabel,
    message,
    issue,
    solution,
    channel,
    whatsappDelivery,
    reporter: {
      nrp,
      name: reporterName,
      whatsapp: user?.whatsapp || null,
      email: user?.email || null,
    },
    dashboard: {
      whatsapp: dashboardWhatsapp,
    },
  });
}

export async function postComplaintInstagram(req, res, next) {
  try {
    await handleComplaint(req, res, "Instagram");
  } catch (err) {
    next(err);
  }
}

export async function postComplaintTiktok(req, res, next) {
  try {
    await handleComplaint(req, res, "TikTok");
  } catch (err) {
    next(err);
  }
}
