import { TRIAGE_CODES } from './claimComplaintTriageService.js';

const UPDATE_PERSONNEL_PATH = '/claim';

const triageContent = Object.freeze({
  [TRIAGE_CODES.ACTIVITY_ALREADY_RECORDED]: {
    title: 'Aktivitas sudah tercatat',
    summary:
      'Aktivitas sudah tersedia di Cicero. Muat ulang halaman untuk melihat hasil pencatatan terbaru.',
    solutions: [
      'Muat ulang halaman claim.',
      'Periksa kembali status aktivitas pada konten yang sama.',
    ],
    canRetry: false,
    canEscalate: false,
  },
  [TRIAGE_CODES.SOCIAL_USERNAME_MISSING]: {
    title: 'Username belum diisi',
    summary: 'Username platform belum tersimpan pada data personel.',
    solutions: [
      `Buka Update Data Personil di ${UPDATE_PERSONNEL_PATH}.`,
      'Isi username yang digunakan untuk melaksanakan aktivitas.',
      'Simpan perubahan lalu lakukan pemeriksaan ulang.',
    ],
    canRetry: true,
    canEscalate: false,
  },
  [TRIAGE_CODES.SOCIAL_USERNAME_MISMATCH]: {
    title: 'Username tidak sesuai',
    summary:
      'Username pelaksana berbeda dari username yang tersimpan pada data personel.',
    solutions: [
      `Buka Update Data Personil di ${UPDATE_PERSONNEL_PATH}.`,
      'Pastikan username tersimpan sama dengan akun yang digunakan.',
      'Simpan perubahan lalu lakukan pemeriksaan ulang.',
    ],
    canRetry: true,
    canEscalate: false,
  },
  [TRIAGE_CODES.SOCIAL_PROFILE_PRIVATE]: {
    title: 'Profil tidak dapat diperiksa',
    summary:
      'Profil bersifat privat sehingga akun dan bukti aktivitas belum dapat diperiksa secara lengkap.',
    solutions: [
      'Pastikan profil dapat diperiksa oleh layanan pengumpulan data.',
      'Lakukan pemeriksaan ulang setelah akses profil tersedia.',
      'Ajukan eskalasi bila profil sudah dapat diperiksa tetapi aktivitas tetap belum terdata.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.SOCIAL_PROFILE_NOT_FOUND]: {
    title: 'Profil belum ditemukan',
    summary: 'Profil pada username tersimpan belum ditemukan saat pemeriksaan.',
    solutions: [
      `Periksa username melalui Update Data Personil di ${UPDATE_PERSONNEL_PATH}.`,
      'Lakukan pemeriksaan ulang setelah memastikan username benar.',
      'Ajukan eskalasi bila profil dapat dibuka tetapi tetap belum terdeteksi.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.SOCIAL_PROFILE_SUSPICIOUS]: {
    title: 'Data profil perlu diperiksa',
    summary:
      'Profil ditemukan, tetapi metrik yang tersedia belum cukup untuk memastikan kondisi akun.',
    solutions: [
      'Lakukan pemeriksaan ulang.',
      'Ajukan eskalasi agar bukti dapat diperiksa oleh operator.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.ENGAGEMENT_NOT_IN_SNAPSHOT]: {
    title: 'Aktivitas belum terlihat',
    summary:
      'Snapshot tersedia, tetapi bukti aktivitas belum ditemukan. Kondisi ini belum menunjukkan kesalahan user.',
    solutions: [
      'Pastikan konten yang diperiksa sudah benar.',
      'Lakukan pemeriksaan ulang.',
      'Ajukan eskalasi agar bukti dapat diperiksa oleh operator.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.DATA_COLLECTION_STALE]: {
    title: 'Menunggu sinkronisasi',
    summary:
      'Snapshot terakhir belum mencakup waktu pelaksanaan. Data sedang menunggu sinkronisasi.',
    solutions: [
      'Tunggu proses sinkronisasi data.',
      'Lakukan pemeriksaan ulang setelah snapshot diperbarui.',
      'Ajukan eskalasi bila aktivitas tetap belum terlihat setelah sinkronisasi.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.UPSTREAM_UNAVAILABLE]: {
    title: 'Pemeriksaan sementara terganggu',
    summary:
      'Layanan pemeriksaan sedang tidak tersedia. Kondisi ini bukan disebabkan oleh data atau tindakan user.',
    solutions: [
      'Lakukan pemeriksaan ulang.',
      'Ajukan eskalasi bila layanan tetap tidak dapat memeriksa bukti.',
    ],
    canRetry: true,
    canEscalate: true,
  },
  [TRIAGE_CODES.MANUAL_REVIEW_REQUIRED]: {
    title: 'Bukti perlu diperiksa',
    summary:
      'Bukti yang tersedia belum cukup untuk menyimpulkan hasil. Kondisi ini belum menunjukkan kesalahan user.',
    solutions: [
      'Lakukan pemeriksaan ulang.',
      'Ajukan eskalasi agar bukti dapat diperiksa oleh operator.',
    ],
    canRetry: true,
    canEscalate: true,
  },
});

function buildEvidence({
  platform,
  contentId,
  registeredUsername,
  lastCollectedAt,
  triageCode,
}) {
  const usernameStatus = registeredUsername ? 'tersedia' : 'belum_diisi';
  const collectionStatus =
    triageCode === TRIAGE_CODES.DATA_COLLECTION_STALE
      ? 'menunggu_sinkronisasi'
      : lastCollectedAt
        ? 'tersedia'
        : 'belum_tersedia';
  return [
    { label: 'Platform', value: platform, status: 'terkonfirmasi' },
    { label: 'ID konten', value: contentId, status: 'terkonfirmasi' },
    {
      label: 'Username tersimpan',
      value: registeredUsername || null,
      status: usernameStatus,
    },
    {
      label: 'Waktu pengumpulan terakhir',
      value: lastCollectedAt,
      status: collectionStatus,
    },
  ];
}

/** Builds the stable API DTO from a completed evidence-based triage decision. */
export function buildClaimTriageResponse({
  platform,
  contentId,
  triageCode,
  triageQuality,
  registeredUsername,
  lastCollectedAt = null,
}) {
  const content =
    triageContent[triageCode] ||
    triageContent[TRIAGE_CODES.MANUAL_REVIEW_REQUIRED];
  return {
    platform,
    content_id: contentId,
    triage_code: triageCode,
    triage_quality: triageQuality,
    title: content.title,
    summary: content.summary,
    evidence: buildEvidence({
      platform,
      contentId,
      registeredUsername,
      lastCollectedAt,
      triageCode,
    }),
    solutions: content.solutions.map((label, index) => ({
      order: index + 1,
      label,
    })),
    last_collected_at: lastCollectedAt,
    can_retry: content.canRetry,
    retry_after: null,
    can_escalate: content.canEscalate,
  };
}

/** Text channels are presentation adapters; they do not determine triage outcomes. */
export function formatClaimTriageText(dto) {
  const evidence = dto.evidence.map(
    (item) => `- ${item.label}: ${item.value ?? '-'} (${item.status})`
  );
  const solutions = dto.solutions.map((item) => `${item.order}. ${item.label}`);
  return [
    dto.title,
    dto.summary,
    '',
    'Bukti:',
    ...evidence,
    '',
    'Langkah:',
    ...solutions,
  ].join('\n');
}
