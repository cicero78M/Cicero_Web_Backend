import { jest } from '@jest/globals';

const mockDbQuery = jest.fn();
const mockRepoQuery = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockDbQuery }));
jest.unstable_mockModule('../src/repository/db.js', () => ({ query: mockRepoQuery }));

const { absensiLoginWeb } = await import('../src/handler/fetchabsensi/dashboard/absensiLoginWeb.js');

beforeEach(() => {
  jest.clearAllMocks();
});

function toJakartaDayBounds(startTime, endTime) {
  return {
    start: new Date(
      `${new Date(startTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })}T00:00:00.000+07:00`
    ),
    end: new Date(
      `${new Date(endTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })}T23:59:59.999+07:00`
    ),
  };
}

test('daily recap ignores directorate client actors', async () => {
  const startTime = new Date('2025-08-02T00:00:00.000Z');
  const endTime = new Date('2025-08-02T23:59:59.999Z');
  const expectedRange = toJakartaDayBounds(startTime, endTime);

  mockRepoQuery.mockImplementation((sql, params) => {
    expect(sql).toContain('FROM login_log ll');
    expect(sql).toContain('dashboard_user_clients');
    expect(sql).toContain("WHERE LOWER(c.client_type) = 'org'");
    expect(params).toEqual(['web', expectedRange.start, expectedRange.end]);
    return {
      rows: [
        {
          actor_id: 'org-actor',
          login_count: '2',
          first_login: expectedRange.start.toISOString(),
          last_login: expectedRange.end.toISOString(),
        },
      ],
    };
  });

  mockDbQuery.mockImplementation((sql, params) => {
    if (sql.includes('FROM dashboard_user')) {
      expect(params).toEqual([['org-actor']]);
      return { rows: [{ actor_id: 'org-actor', username: 'dina', role: 'operator' }] };
    }
    if (sql.includes('FROM penmas_user')) {
      expect(params).toEqual([['org-actor']]);
      return { rows: [] };
    }
    return { rows: [] };
  });

  const message = await absensiLoginWeb({ mode: 'harian', startTime, endTime });

  expect(mockRepoQuery).toHaveBeenCalledTimes(1);
  expect(message).toContain('Rekap Login Web (Harian)');
  expect(message).toContain('Total hadir: 1 user (2 login)');
  expect(message).toMatch(/1\. dina \(dashboard - OPERATOR\) — 2 kali/);
  expect(message).not.toMatch(/dir-actor/i);
});

test('weekly recap ignores directorate client actors', async () => {
  const startTime = new Date('2025-08-04T00:00:00.000Z');
  const endTime = new Date('2025-08-10T23:59:59.999Z');
  const expectedRange = toJakartaDayBounds(startTime, endTime);

  mockRepoQuery.mockImplementation((sql, params) => {
    expect(sql).toContain('JOIN org_actors');
    expect(sql).toContain("WHERE LOWER(c.client_type) = 'org'");
    expect(params).toEqual(['web', expectedRange.start, expectedRange.end]);
    return {
      rows: [
        {
          actor_id: 'org-weekly',
          login_count: '4',
          first_login: expectedRange.start.toISOString(),
          last_login: expectedRange.end.toISOString(),
        },
      ],
    };
  });

  mockDbQuery.mockImplementation((sql, params) => {
    if (sql.includes('FROM dashboard_user')) {
      expect(params).toEqual([['org-weekly']]);
      return { rows: [{ actor_id: 'org-weekly', username: 'rudi', role: 'supervisor' }] };
    }
    if (sql.includes('FROM penmas_user')) {
      expect(params).toEqual([['org-weekly']]);
      return { rows: [] };
    }
    return { rows: [] };
  });

  const message = await absensiLoginWeb({ mode: 'mingguan', startTime, endTime });

  expect(mockRepoQuery).toHaveBeenCalledTimes(1);
  expect(message).toContain('Rekap Login Web (Mingguan)');
  expect(message).toContain('Total hadir: 1 user (4 login)');
  expect(message).toMatch(/1\. rudi \(dashboard - SUPERVISOR\) — 4 kali/);
  expect(message).not.toMatch(/dir-actor/i);
});
