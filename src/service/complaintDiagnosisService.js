import { formatComplaintIssue } from '../utils/utilsHelper.js';
import {
  UPDATE_DATA_LINK,
  buildActivityNotRecordedSolution,
  buildAccountStatus,
  buildComplaintSolutionsFromIssues,
  buildUpdateDataInstructions,
} from './complaintService.js';
import {
  RAPID_API_OUTCOMES,
  triageClaimComplaintEvidence,
} from './claimComplaintTriageService.js';

function isUserActive(user) {
  if (!user) return false;
  if (user.status === null || user.status === undefined) return true;
  if (typeof user.status === 'string') {
    return ['true', '1', 'aktif'].includes(user.status.trim().toLowerCase());
  }
  if (typeof user.status === 'number') return user.status === 1;
  return Boolean(user.status);
}

function buildFormattedIssue({ parsedComplaint, userId, fallbackIssue }) {
  const issues = Array.isArray(parsedComplaint?.issues)
    ? parsedComplaint.issues.filter((issue) => issue && issue.trim())
    : [];
  if (!issues.length) {
    return formatComplaintIssue(parsedComplaint?.raw || fallbackIssue || '');
  }
  return formatComplaintIssue(
    [
      'Pesan Komplain',
      `NRP/NIP: ${parsedComplaint?.nrp || userId || '-'}`,
      parsedComplaint?.name ? `Nama: ${parsedComplaint.name}` : '',
      parsedComplaint?.polres ? `Polres: ${parsedComplaint.polres}` : '',
      parsedComplaint?.instagram
        ? `Instagram: ${parsedComplaint.instagram}`
        : '',
      parsedComplaint?.tiktok ? `TikTok: ${parsedComplaint.tiktok}` : '',
      '',
      'Kendala',
      ...issues.map((issue) => `- ${issue}`),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

export async function diagnoseComplaint({
  user,
  userId,
  parsedComplaint,
  fallbackIssue,
  fallbackSolution = '',
  claimPlatform,
  selectedContent,
}) {
  const formattedIssue = buildFormattedIssue({
    parsedComplaint,
    userId,
    fallbackIssue,
  });
  let issue = formattedIssue || fallbackIssue;
  let solution = '';
  let triageCode = 'MANUAL_REVIEW_REQUIRED';
  let triageQuality = 'low';
  const evidence = [];

  if (!isUserActive(user)) {
    issue = formattedIssue || 'Akun personel tidak aktif.';
    solution = [
      'Akun Cicero personel saat ini *tidak aktif*.',
      'Mohon hubungi operator satker untuk melakukan aktivasi akun sebelum melanjutkan pelaporan tugas atau komplain.',
      'Setelah akun aktif, silakan informasikan kembali melalui menu *Client Request* bila kendala masih terjadi.',
    ].join('\n');
    evidence.push({ type: 'user_status', value: 'inactive' });
  } else {
    const accountStatus = await buildAccountStatus(user);
    const instagram =
      typeof user.insta === 'string' ? user.insta.trim() : user.insta || '';
    const tiktok =
      typeof user.tiktok === 'string' ? user.tiktok.trim() : user.tiktok || '';
    const platform =
      claimPlatform || (parsedComplaint?.instagram ? 'instagram' : 'tiktok');
    const handle = platform === 'instagram' ? instagram : tiktok;
    evidence.push({
      type: 'registered_handle',
      platform,
      available: Boolean(handle),
    });

    if (!instagram && !tiktok) {
      issue = 'Akun sosial media masih belum terisi';
      solution = [
        'Belum terdapat username Instagram maupun TikTok pada data personel.',
        '',
        'Langkah tindak lanjut:',
        buildUpdateDataInstructions('Instagram dan TikTok'),
        '',
        `Tautan update data personel: ${UPDATE_DATA_LINK}`,
      ].join('\n');
    } else {
      const result = claimPlatform
        ? await buildActivityNotRecordedSolution(
            claimPlatform,
            fallbackIssue,
            parsedComplaint,
            user,
            accountStatus,
            selectedContent
          )
        : await buildComplaintSolutionsFromIssues(
            parsedComplaint,
            user,
            accountStatus
          );
      solution = result.solutionText;
      evidence.push({
        type: 'matched_issue_keys',
        values: [...result.handledKeys],
      });
    }

    const profileStatus = accountStatus?.[platform] || {};
    const profileOutcome = profileStatus.upstreamOutcome || (profileStatus.error
      ? RAPID_API_OUTCOMES.UNAVAILABLE
      : profileStatus.found
        ? RAPID_API_OUTCOMES.AVAILABLE
        : RAPID_API_OUTCOMES.NOT_FOUND);
    ({ triageCode, triageQuality } = triageClaimComplaintEvidence({
      registeredUsername: handle,
      activityRecorded: Boolean(selectedContent?.hasActivity),
      snapshotAvailable: Boolean(selectedContent?.snapshotAvailable),
      snapshotUpdatedAt: selectedContent?.snapshotUpdatedAt,
      performedAt: selectedContent?.performedAt,
      profile: {
        outcome: profileOutcome,
        exists: Boolean(profileStatus.found),
        isPrivate: /privat/i.test(profileStatus.state || ''),
        metrics: {
          posts: profileStatus.posts,
          followers: profileStatus.followers,
          following: profileStatus.following,
          likes: profileStatus.likes,
        },
      },
    }));
  }

  return {
    issue,
    solution: solution || fallbackSolution,
    triageCode,
    triageQuality,
    evidence,
    canEscalate: triageCode !== 'ACTIVITY_ALREADY_RECORDED',
  };
}
