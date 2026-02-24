import { jest } from '@jest/globals';

import { PRIORITY_USER_NAMES } from '../src/utils/constants.js';

const mockQuery = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery,
}));

let getRekapKomentarByClient;

beforeAll(async () => {
  ({ getRekapKomentarByClient } = await import('../src/model/tiktokCommentModel.js'));
});

beforeEach(() => {
  mockQuery.mockReset();
});

function mockClientType(type = 'instansi') {
  mockQuery.mockResolvedValueOnce({ rows: [{ client_type: type }] });
}

const PRIORITY_UPPER = PRIORITY_USER_NAMES.map(name => name.toUpperCase());

test('getRekapKomentarByClient uses post created_at BETWEEN for date range in both CTEs', async () => {
  mockClientType();
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('POLRES', 'harian', null, '2024-01-01', '2024-01-31');
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1][0]).toContain('p.created_at');
  expect(mockQuery.mock.calls[1][0]).not.toContain("(c.updated_at AT TIME ZONE 'UTC')");
  expect(mockQuery.mock.calls[1][0]).toContain('BETWEEN');
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['POLRES', '2024-01-01', '2024-01-31']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
});


test('getRekapKomentarByClient keeps comment period based on post date even if comment updated_at shifts', async () => {
  mockClientType();
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('POLRES', 'harian', null, '2024-01-01', '2024-01-31');

  const sql = mockQuery.mock.calls[1][0];
  expect(sql).toContain('valid_comments AS (');
  expect(sql).toContain('total_posts AS (');
  const createdAtMatches = sql.match(/COALESCE\(p\.original_created_at, p\.created_at\)/g) || [];
  expect(createdAtMatches.length).toBeGreaterThanOrEqual(2);
  expect(sql).not.toContain("((c.updated_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta')");
});

test('getRekapKomentarByClient filters directorate users by ditbinmas role only', async () => {
  mockClientType('direktorat');
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('ditbinmas', 'harian', undefined, undefined, undefined, 'ditbinmas');
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[0][0]).toContain('SELECT client_type FROM clients');
  const sql = mockQuery.mock.calls[1][0];
  expect(sql).toContain('EXISTS (');
  expect(sql).toContain('r.role_name = $');
  expect(sql).toContain('LEFT JOIN tiktok_post_roles pr');
  expect(sql).toMatch(/LOWER\(pr\.role_name\) = LOWER\(\$\d+\)/);
  expect(sql).toContain('pr.video_id IS NOT NULL');
  expect(sql).not.toContain('NOT EXISTS (');
  expect(sql).not.toContain('LOWER(u.client_id) = ANY');
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['ditbinmas']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
});

test('ditbinmas recap counts only ditbinmas-scoped posts and respects tanggal filter', async () => {
  mockClientType('direktorat');
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('ditbinmas', 'harian', '2024-02-10', undefined, undefined, 'ditbinmas');

  expect(mockQuery).toHaveBeenCalledTimes(2);
  const sql = mockQuery.mock.calls[1][0];
  expect(sql).toContain('pr.video_id IS NOT NULL');
  expect(sql).toContain('COALESCE(p.original_created_at, p.created_at)');
  expect(sql).toContain('::date = $1::date');
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['2024-02-10', 'ditbinmas']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
});

test('getRekapKomentarByClient orders nama by priority list', async () => {
  mockClientType();
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('POLRES');
  const sql = mockQuery.mock.calls[1][0];
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['POLRES']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
  const matches = sql.match(/WHEN UPPER\(u\.nama\) = \$\d+/g) || [];
  expect(matches.length).toBeGreaterThanOrEqual(PRIORITY_UPPER.length);
  expect(sql).toContain('CASE WHEN');
  expect(sql).toContain('UPPER(u.nama)');
});


test('getRekapKomentarByClient can include task links metadata when requested', async () => {
  mockClientType();
  mockQuery.mockResolvedValueOnce({
    rows: [{ user_id: 'u1', username: 'alice', jumlah_komentar: '1', total_konten: '2' }]
  });
  mockQuery.mockResolvedValueOnce({ rows: [{ video_id: 'v100' }, { video_id: 'v200' }] });

  const result = await getRekapKomentarByClient(
    'POLRES',
    'harian',
    undefined,
    undefined,
    undefined,
    undefined,
    { includeTaskLinks: true }
  );

  expect(mockQuery).toHaveBeenCalledTimes(3);
  expect(result).toEqual(
    expect.objectContaining({
      totalKonten: 2,
      taskLinksToday: {
        platform: 'tiktok',
        links: [
          'https://www.tiktok.com/video/v100',
          'https://www.tiktok.com/video/v200'
        ]
      }
    })
  );
  expect(result.rows[0].jumlah_komentar).toBe(1);
});
