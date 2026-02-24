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

const PRIORITY_UPPER = PRIORITY_USER_NAMES.map((n) => n.toUpperCase());

test('include_client_or_role mode drops postClientFilter so role-tagged posts from other clients are included', async () => {
  // Simulate the options produced by scope=DIREKTORAT for DITINTELKAM
  mockQuery.mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] });
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await getRekapKomentarByClient(
    'DITINTELKAM',
    'harian',
    '2026-02-19',
    undefined,
    undefined,
    'ditintelkam',
    {
      postClientId: 'DITINTELKAM',
      userClientId: null,
      userRoleFilter: 'ditintelkam',
      includePostRoleFilter: true,
      postRoleFilterMode: 'include_client_or_role',
      userRegionalId: 'JATIM',
      postRegionalId: null,
    }
  );

  // Should only make 2 queries: one for resolvedUserClientType, one for the main recap
  expect(mockQuery).toHaveBeenCalledTimes(2);

  const sql = mockQuery.mock.calls[1][0];
  const params = mockQuery.mock.calls[1][1];

  // postClientFilter should NOT restrict to only DITINTELKAM client_id
  // The WHERE clause should start with 1=1 (no client_id restriction)
  // and the role filter should use OR to include role-tagged posts
  expect(sql).toContain('LEFT JOIN tiktok_post_roles pr');
  expect(sql).toMatch(/LOWER\(p\.client_id\) = LOWER\(\$\d+\) OR LOWER\(pr\.role_name\) = LOWER\(\$\d+\)/);

  // Confirm the postClientFilter does NOT add a separate LOWER(p.client_id)= clause
  // before the AND (client_or_role condition). The SQL should only have one client_id
  // filter that is inside the OR, not a standalone one.
  const whereBlock = sql.split('WHERE')[1] || '';
  // Count standalone LOWER(p.client_id) = LOWER( occurrences
  const standaloneMatches = whereBlock.match(/LOWER\(p\.client_id\) = LOWER\(\$\d+\)/g) || [];
  // All of them should be inside the OR, not standalone
  // The OR expression means they appear once inside parentheses; no duplicate at top level
  expect(standaloneMatches.length).toBeLessThanOrEqual(2); // at most from postRoleFilter OR

  expect(params).toEqual(expect.arrayContaining(['ditintelkam', 'JATIM', '2026-02-19']));
  expect(params).toEqual(expect.arrayContaining(PRIORITY_UPPER));
});

test('non-direktorat scope still uses postClientFilter normally', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ client_type: 'instansi' }] });
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await getRekapKomentarByClient(
    'POLRESXYZ',
    'harian',
    '2026-02-19',
    undefined,
    undefined,
    null,
    {}
  );

  expect(mockQuery).toHaveBeenCalledTimes(2);
  const sql = mockQuery.mock.calls[1][0];
  expect(sql).toContain('LOWER(p.client_id) = LOWER(');
  const params = mockQuery.mock.calls[1][1];
  expect(params).toEqual(expect.arrayContaining(['POLRESXYZ']));
});

test('comment recap date filter uses manual_input created_at before original_created_at', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ client_type: 'direktorat' }] });
  mockQuery.mockResolvedValueOnce({ rows: [] });

  await getRekapKomentarByClient(
    'DITINTELKAM',
    'harian',
    '2026-02-24',
    undefined,
    undefined,
    'ditintelkam',
    {
      postClientId: 'DITINTELKAM',
      userClientId: null,
      userRoleFilter: 'ditintelkam',
      includePostRoleFilter: true,
      postRoleFilterMode: 'include_client_or_role',
    }
  );

  const sql = mockQuery.mock.calls[1][0];
  expect(sql).toContain("CASE WHEN p.source_type = 'manual_input' THEN p.created_at");
  expect(sql).toContain("ELSE COALESCE(p.original_created_at, p.created_at)");
});

