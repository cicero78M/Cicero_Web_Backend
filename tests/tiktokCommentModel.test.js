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

test('getRekapKomentarByClient uses updated_at BETWEEN for date range', async () => {
  mockClientType();
  mockQuery.mockResolvedValueOnce({ rows: [] });
  await getRekapKomentarByClient('POLRES', 'harian', null, '2024-01-01', '2024-01-31');
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1][0]).toContain('c.updated_at');
  expect(mockQuery.mock.calls[1][0]).toContain('BETWEEN');
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['POLRES', '2024-01-01', '2024-01-31']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
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
  expect(sql).toContain('p.created_at AT TIME ZONE');
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
