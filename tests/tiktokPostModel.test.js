import { jest } from '@jest/globals';

const mockQuery = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery,
}));

let getPostsTodayByClient;
let getVideoIdsTodayByClient;
let countPostsByClient;

const toJakartaDateInput = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(date);

beforeAll(async () => {
  ({ getPostsTodayByClient, getVideoIdsTodayByClient, countPostsByClient } = await import(
    '../src/model/tiktokPostModel.js'
  ));
});

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

test('getPostsTodayByClient filters by Jakarta date and orders results', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2024-07-01T17:00:00.000Z'));
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const expectedDate = toJakartaDateInput(new Date('2024-07-01T17:00:00.000Z'));

  await getPostsTodayByClient('Client 1');

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/AT TIME ZONE 'UTC'\)\s*AT TIME ZONE 'Asia\/Jakarta'\)\:\:date = \$2\:\:date/i),
    ['client 1', expectedDate]
  );
  expect(mockQuery.mock.calls[0][0]).toMatch(/ORDER BY\s+COALESCE\(original_created_at,\s*created_at\)\s+ASC,\s+video_id\s+ASC/i);
});

test('getPostsTodayByClient respects Jakarta-normalized referenceDate on non-WIB servers', async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'America/New_York';
  mockQuery.mockResolvedValueOnce({ rows: [] });

  try {
    const referenceDate = new Date('2024-06-30T17:00:00.000Z');
    const expectedDate = toJakartaDateInput(referenceDate);

    await getPostsTodayByClient('Client 2', referenceDate);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/AT TIME ZONE 'UTC'\)\s*AT TIME ZONE 'Asia\/Jakarta'\)\:\:date = \$2\:\:date/i),
      ['client 2', expectedDate]
    );
  } finally {
    process.env.TZ = originalTZ;
  }
});

test('getVideoIdsTodayByClient applies Jakarta date filter for reference date', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const referenceDate = new Date('2024-05-10T18:30:00.000Z');
  const expectedDate = toJakartaDateInput(referenceDate);

  await getVideoIdsTodayByClient('Client 3', referenceDate);

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/AT TIME ZONE 'UTC'\)\s*AT TIME ZONE 'Asia\/Jakarta'\)\:\:date = \$2\:\:date/i),
    ['client 3', expectedDate]
  );
});

test('countPostsByClient filters by client_id when no scope supplied', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '4' }] });

  const result = await countPostsByClient('C1', 'harian', undefined, undefined, undefined, {});

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('COUNT(DISTINCT p.video_id)');
  expect(sql).toContain('LOWER(TRIM(p.client_id)) = LOWER($1)');
  expect(result).toBe(4);
});

test('countPostsByClient applies role join for directorate scope', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '2' }] });

  await countPostsByClient('DITA', 'harian', undefined, undefined, undefined, {
    role: 'dita',
    scope: 'direktorat',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('LEFT JOIN tiktok_post_roles pr ON pr.video_id = p.video_id');
  expect(sql).toContain('LOWER(TRIM(p.client_id)) = LOWER($1)');
  expect(sql).toContain('OR LOWER(TRIM(pr.role_name)) = LOWER($1)');
});

test('countPostsByClient filters by regional_id when provided', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '3' }] });

  await countPostsByClient('C1', 'harian', undefined, undefined, undefined, {
    regionalId: 'jatim',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  const sql = mockQuery.mock.calls[0][0];
  expect(sql).toContain('JOIN clients c ON c.client_id = p.client_id');
  expect(sql).toContain('UPPER(c.regional_id) = $2');
});

test('countPostsByClient returns first scoped count result', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ jumlah_post: '0' }] });

  const result = await countPostsByClient('DITA', 'harian', undefined, undefined, undefined, {
    role: 'dita',
    scope: 'direktorat',
  });

  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(result).toBe(0);
});

test('getVideoIdsTodayByClient treats late-night UTC as same Jakarta day', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });
  const nearMidnightUtc = new Date('2024-02-29T17:30:00.000Z');
  const expectedJakarta = toJakartaDateInput(nearMidnightUtc);

  await getVideoIdsTodayByClient('Client 4', nearMidnightUtc);

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringMatching(/AT TIME ZONE 'UTC'\)\s*AT TIME ZONE 'Asia\/Jakarta'\)\:\:date = \$2\:\:date/i),
    ['client 4', expectedJakarta]
  );
  expect(expectedJakarta).toBe('2024-03-01');
});
