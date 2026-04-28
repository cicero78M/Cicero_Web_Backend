import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockGetRekapLikesByClient = jest.fn();
const mockGetRekapKomentarByClient = jest.fn();

jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findById: mockFindById,
}));

jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
  getRekapLikesByClient: mockGetRekapLikesByClient,
}));

jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getRekapKomentarByClient: mockGetRekapKomentarByClient,
}));

const service = await import('../src/service/dashboardPremiumInsightService.js');

describe('dashboardPremiumInsightService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('buildRiskSummaryFromRecap marks high risk when compliance is low and action pending exists', () => {
    const result = service.buildRiskSummaryFromRecap({
      platformLabel: 'Instagram',
      periodLabel: '2026-04-28',
      recap: {
        summary: {
          totalUsers: 10,
          averageCompletionPercentage: 42,
          distribution: {
            sudah: 2,
            kurang: 3,
            belum: 4,
            noUsername: 1,
          },
        },
      },
    });

    expect(result.actionNeededCount).toBe(7);
    expect(result.alerts[0].severity).toBe('medium');
    expect(result.alerts.some((alert) => alert.id === 'compliance')).toBe(true);
  });

  test('getDashboardPremiumExecutiveRecap returns formatted payload for instagram', async () => {
    mockFindById.mockResolvedValue({ nama: 'Polres Contoh', client_type: 'org' });
    mockGetRekapLikesByClient.mockResolvedValue({
      rows: [
        { username: 'user1', jumlah_like: 2 },
        { username: 'user2', jumlah_like: 0 },
        { username: '', jumlah_like: 0 },
      ],
      totalKonten: 2,
      taskLinksToday: { platform: 'instagram', links: [] },
    });

    const result = await service.getDashboardPremiumExecutiveRecap({
      dashboardUser: {
        client_id: 'polres-a',
        client_ids: ['polres-a'],
        role: 'operator',
      },
      query: {
        client_id: 'polres-a',
        role: 'operator',
        scope: 'org',
        platform: 'instagram',
        periode: 'harian',
      },
    });

    expect(result.success).toBe(true);
    expect(result.data.clientName).toBe('Polres Contoh');
    expect(result.data.text).toContain('Briefing Instagram');
    expect(result.data.stats.totalPosts).toBe(2);
  });
});
