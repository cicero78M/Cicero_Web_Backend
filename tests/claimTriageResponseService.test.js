import {
  buildClaimTriageResponse,
  formatClaimTriageText,
} from '../src/service/claimTriageResponseService.js';

const baseInput = {
  platform: 'instagram',
  contentId: 'ABC123',
  triageQuality: 'high',
  registeredUsername: '@personel',
  lastCollectedAt: '2026-08-09T03:05:00.000Z',
};

describe('claim triage response DTO', () => {
  test.each([
    [
      'ACTIVITY_ALREADY_RECORDED',
      'Aktivitas sudah tercatat',
      false,
      false,
      'Muat ulang halaman claim.',
    ],
    [
      'SOCIAL_USERNAME_MISSING',
      'Username belum diisi',
      true,
      false,
      'Update Data Personil',
    ],
    [
      'SOCIAL_USERNAME_MISMATCH',
      'Username tidak sesuai',
      true,
      false,
      'Update Data Personil',
    ],
    [
      'SOCIAL_PROFILE_PRIVATE',
      'Profil tidak dapat diperiksa',
      true,
      true,
      'dapat diperiksa',
    ],
    [
      'DATA_COLLECTION_STALE',
      'Menunggu sinkronisasi',
      true,
      true,
      'sinkronisasi',
    ],
    [
      'UPSTREAM_UNAVAILABLE',
      'Pemeriksaan sementara terganggu',
      true,
      true,
      'pemeriksaan ulang',
    ],
    [
      'MANUAL_REVIEW_REQUIRED',
      'Bukti perlu diperiksa',
      true,
      true,
      'pemeriksaan ulang',
    ],
  ])(
    'maps %s to stable Indonesian guidance',
    (triageCode, title, canRetry, canEscalate, guidance) => {
      const dto = buildClaimTriageResponse({ ...baseInput, triageCode });

      expect(dto).toMatchObject({
        platform: 'instagram',
        content_id: 'ABC123',
        triage_code: triageCode,
        title,
        can_retry: canRetry,
        retry_after: null,
        can_escalate: canEscalate,
      });
      expect(dto.solutions.map(({ label }) => label).join(' ')).toContain(
        guidance
      );
      expect(
        dto.evidence.every(
          (item) => Object.keys(item).sort().join(',') === 'label,status,value'
        )
      ).toBe(true);
    }
  );

  test('text formatter only renders an existing DTO', () => {
    const dto = buildClaimTriageResponse({
      ...baseInput,
      triageCode: 'ACTIVITY_ALREADY_RECORDED',
    });
    const message = formatClaimTriageText(dto);

    expect(message).toContain(dto.title);
    expect(message).toContain(dto.summary);
    expect(message).toContain(`1. ${dto.solutions[0].label}`);
  });
});
