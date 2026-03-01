import { jest } from '@jest/globals';

const mockGetRekap = jest.fn();
const mockFindClientById = jest.fn();
jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getRekapKomentarByClient: mockGetRekap,
  deleteCommentsByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/service/tiktokCommentService.js', () => ({}));
jest.unstable_mockModule('../src/service/tiktokPostService.js', () => ({}));
jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));
jest.unstable_mockModule('../src/utils/response.js', () => ({ sendSuccess: jest.fn() }));
jest.unstable_mockModule('../src/service/tiktokApi.js', () => ({
  fetchTiktokProfile: jest.fn(),
  fetchTiktokPosts: jest.fn(),
  fetchTiktokPostsBySecUid: jest.fn(),
  fetchTiktokInfo: jest.fn(),
}));
jest.unstable_mockModule('../src/service/profileCacheService.js', () => ({}));

let getTiktokRekapKomentar;
beforeAll(async () => {
  ({ getTiktokRekapKomentar } = await import('../src/controller/tiktokController.js'));
});

beforeEach(() => {
  mockGetRekap.mockReset();
  mockFindClientById.mockReset();
});

test('accepts tanggal_mulai and tanggal_selesai', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = {
    query: {
      client_id: 'DITBINMAS',
      periode: 'harian',
      tanggal_mulai: '2024-01-01',
      tanggal_selesai: '2024-01-31'
    },
    headers: {}
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getTiktokRekapKomentar(req, res);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'DITBINMAS',
    'harian',
    undefined,
    '2024-01-01',
    '2024-01-31',
    undefined,
    expect.any(Object)
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ chartHeight: 320 }));
});

test('returns user comment summaries with counts', async () => {
  const rows = [
    { username: 'alice', jumlah_komentar: 2 },
    { username: 'bob', jumlah_komentar: 0 },
    { username: 'charlie', jumlah_komentar: 1 }
  ];
  mockGetRekap.mockResolvedValue(rows);
  const req = { query: { client_id: 'DITBINMAS' }, headers: {} };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getTiktokRekapKomentar(req, res);
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      usersWithComments: ['alice', 'charlie'],
      usersWithoutComments: ['bob'],
      usersWithCommentsCount: 2,
      usersWithoutCommentsCount: 1,
      usersCount: 3
    })
  );
});



test('scope direktorat forwards post role+client merge options', async () => {
  mockGetRekap.mockResolvedValue([]);
  mockFindClientById.mockResolvedValue({ client_type: 'direktorat', switch_satik: true });
  const req = {
    query: {
      client_id: 'DITINTELKAM',
      periode: 'harian',
      tanggal: '2026-02-19',
      role: 'ditintelkam',
      scope: 'DIREKTORAT',
      regional_id: 'JATIM'
    },
    user: {
      client_id: 'DITINTELKAM',
      role: 'ditintelkam'
    },
    headers: {}
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };

  await getTiktokRekapKomentar(req, res);

  expect(mockGetRekap).toHaveBeenCalledWith(
    'DITINTELKAM',
    'harian',
    '2026-02-19',
    undefined,
    undefined,
    'ditintelkam',
    expect.objectContaining({
      postClientId: 'DITINTELKAM',
      userClientId: null,
      userRoleFilter: 'ditintelkam',
      includePostRoleFilter: true,
      postRoleFilterMode: 'include_client_or_role',
      userRegionalId: 'JATIM',
      postRegionalId: 'JATIM',
      includeTaskLinks: true,
      satikDivisionMode: 'org_include_only',
    })
  );
});


test('scope org ditintelkam enables satik filter for org client without switch_satik', async () => {
  mockGetRekap.mockResolvedValue([]);
  mockFindClientById.mockResolvedValue({ client_type: 'org', switch_satik: false });
  const req = {
    query: {
      client_id: 'NGAWI',
      periode: 'harian',
      tanggal: '2026-03-01',
      role: 'ditintelkam',
      scope: 'ORG',
      regional_id: 'JATIM'
    },
    user: {
      client_id: 'NGAWI',
      role: 'ditintelkam'
    },
    headers: {}
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };

  await getTiktokRekapKomentar(req, res);

  expect(mockGetRekap).toHaveBeenCalledWith(
    'NGAWI',
    'harian',
    '2026-03-01',
    undefined,
    undefined,
    'ditintelkam',
    expect.objectContaining({
      postClientId: 'ditintelkam',
      userClientId: 'NGAWI',
      userRoleFilter: 'ditintelkam',
      includePostRoleFilter: false,
      userRegionalId: 'JATIM',
      postRegionalId: 'JATIM',
      includeTaskLinks: true,
      satikDivisionMode: 'include_only',
    })
  );
});


test('returns taskLinksToday when model provides recap meta', async () => {
  mockGetRekap.mockResolvedValue({
    rows: [{ username: 'alice', jumlah_komentar: 1, total_konten: 2 }],
    totalKonten: 2,
    taskLinksToday: {
      platform: 'tiktok',
      links: ['https://www.tiktok.com/video/1234567890']
    }
  });
  const req = { query: { client_id: 'DITINTELKAM' }, headers: {} };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };

  await getTiktokRekapKomentar(req, res);

  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      taskLinksToday: {
        platform: 'tiktok',
        links: ['https://www.tiktok.com/video/1234567890']
      }
    })
  );
});
