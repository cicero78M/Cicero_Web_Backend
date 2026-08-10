// src/controller/complaintController.js
import * as userModel from '../model/userModel.js';
import { sendSuccess } from '../utils/response.js';
import {
  formatNama,
  getGreeting,
  normalizeUserId,
} from '../utils/utilsHelper.js';
import {
  normalizeComplaintHandle,
  parseComplaintMessage,
} from '../service/complaintService.js';
import { diagnoseComplaint } from '../service/complaintDiagnosisService.js';

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function resolveComplaintSource(body) {
  return (
    normalizeText(body.message) ||
    normalizeText(body.pesan) ||
    normalizeText(body.complaint) ||
    normalizeText(body.raw) ||
    normalizeText(body.text) ||
    ''
  );
}

function normalizeClientId(value) {
  if (!value) return '';
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
  return { instagram: instagram || '', tiktok: tiktok || '' };
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
    'Jika diperlukan, kami akan menghubungi kembali setelah pengecekan.',
  ].join(' ');
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
    .join('\n')
    .trim();
}

async function handleComplaint(req, res, platformLabel) {
  const rawNrp = req.body?.nrp;
  const nrp = normalizeUserId(rawNrp);
  if (!nrp) {
    return res.status(400).json({ success: false, message: 'nrp wajib diisi' });
  }

  const user = await userModel.findUserById(nrp);
  if (!user) {
    return res
      .status(404)
      .json({ success: false, message: 'User tidak ditemukan' });
  }

  const targetClientId = user.client_id;
  const clientIdFromToken = req.user?.client_id;
  // Dashboard users can handle complaints for any client
  // Only check authorization for regular client users
  if (!req.dashboardUser && clientIdFromToken) {
    if (!isClientAuthorized(clientIdFromToken, targetClientId)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }

  const reporterName = formatNama(user) || user.nama || nrp;
  const complaintSource = resolveComplaintSource(req.body || {});
  const parsedComplaint = complaintSource
    ? parseComplaintMessage(complaintSource)
    : { raw: '', issues: [] };

  if (!parsedComplaint.nrp) {
    parsedComplaint.nrp = nrp;
  }

  if (!parsedComplaint.instagram || !parsedComplaint.tiktok) {
    const handles = resolveComplaintHandles(req.body || {});
    parsedComplaint.instagram = parsedComplaint.instagram || handles.instagram;
    parsedComplaint.tiktok = parsedComplaint.tiktok || handles.tiktok;
  }

  if (
    !Array.isArray(parsedComplaint.issues) ||
    parsedComplaint.issues.length === 0
  ) {
    const fallbackIssue = resolveIssueText(req.body || {}, platformLabel);
    parsedComplaint.issues = fallbackIssue ? [fallbackIssue] : [];
    parsedComplaint.raw = parsedComplaint.raw || fallbackIssue;
  }

  const diagnosis = await diagnoseComplaint({
    user,
    userId: nrp,
    parsedComplaint,
    fallbackIssue: resolveIssueText(req.body || {}, platformLabel),
    fallbackSolution: resolveSolutionText(req.body || {}, platformLabel),
  });
  const { issue, solution } = diagnosis;

  const message = buildComplaintMessage({ reporterName, nrp, issue, solution });

  sendSuccess(res, {
    platform: platformLabel,
    message,
    issue,
    solution,
    reporter: {
      nrp,
      name: reporterName,
      whatsapp: user?.whatsapp || null,
      email: user?.email || null,
    },
  });
}

export async function postComplaintInstagram(req, res, next) {
  try {
    await handleComplaint(req, res, 'Instagram');
  } catch (err) {
    next(err);
  }
}

export async function postComplaintTiktok(req, res, next) {
  try {
    await handleComplaint(req, res, 'TikTok');
  } catch (err) {
    next(err);
  }
}
