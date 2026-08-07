import { jest } from '@jest/globals';

const query = jest.fn();
jest.unstable_mockModule('../src/repository/db.js', () => ({ query }));
const { getPendingContentForUser } = await import(
  '../src/service/claimPendingContentService.js'
);

const filters = {
  periode: 'harian',
  tanggal: undefined,
  startDate: undefined,
  endDate: undefined,
};

function mockContextAndAccounts(accounts) {
  query
    .mockResolvedValueOnce({
      rows: [{ user_id: 'user-1', client_id: 'CLIENT-A', roles: ['ditbinmas'] }],
    })
    .mockResolvedValueOnce({ rows: accounts });
}

describe('claimPendingContentService', () => {
  beforeEach(() => query.mockReset());

  test('returns null when the authenticated user is not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getPendingContentForUser('missing', filters)).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('returns empty items and username_available false without platform usernames', async () => {
    mockContextAndAccounts([]);
    const result = await getPendingContentForUser('user-1', filters);
    expect(result.instagram).toMatchObject({ username_available: false, items: [] });
    expect(result.tiktok).toMatchObject({ username_available: false, items: [] });
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('matches completion across multiple active accounts and returns only pending items', async () => {
    mockContextAndAccounts([
      { platform: 'instagram', username: '@primary' },
      { platform: 'instagram', username: 'backup' },
      { platform: 'tiktok', username: '@tik.primary' },
    ]);
    query
      .mockResolvedValueOnce({
        rows: [
          { shortcode: 'done', completed: true },
          { shortcode: 'pending', completed: false },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ video_id: 'video-done', url: null, completed: true }] });

    const result = await getPendingContentForUser('user-1', filters);
    expect(result.instagram.usernames).toEqual(['primary', 'backup']);
    expect(result.instagram).toMatchObject({
      total_content: 2,
      completed_content: 1,
      pending_content: 1,
      items: [{ shortcode: 'pending' }],
    });
    expect(result.tiktok).toMatchObject({ pending_content: 0, items: [] });
  });

  test('returns no content when scoped queries find no posts', async () => {
    mockContextAndAccounts([
      { platform: 'instagram', username: 'ig-user' },
      { platform: 'tiktok', username: 'tt-user' },
    ]);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const result = await getPendingContentForUser('user-1', filters);
    expect(result.instagram.total_content).toBe(0);
    expect(result.tiktok.total_content).toBe(0);
  });

  test('keeps all scoped content pending when none is completed', async () => {
    mockContextAndAccounts([{ platform: 'instagram', username: 'ig-user' }]);
    query.mockResolvedValueOnce({
      rows: [
        { shortcode: 'one', completed: false },
        { shortcode: 'two', completed: false },
      ],
    });
    const result = await getPendingContentForUser('user-1', filters);
    expect(result.instagram.pending_content).toBe(2);
    expect(result.instagram.items).toHaveLength(2);
  });

  test('queries only token user accounts and enforces client/role scope in SQL', async () => {
    mockContextAndAccounts([{ platform: 'tiktok', username: 'owner' }]);
    query.mockResolvedValueOnce({ rows: [] });
    await getPendingContentForUser('user-1', filters);

    expect(query.mock.calls[0][1]).toEqual(['user-1']);
    expect(query.mock.calls[1][1]).toEqual(['user-1']);
    const [tiktokSql, tiktokParams] = query.mock.calls[2];
    expect(tiktokSql).toContain('LOWER(p.client_id) = LOWER($1)');
    expect(tiktokSql).toContain('FROM tiktok_post_roles');
    expect(tiktokSql).toContain('LOWER(pr.role_name) = ANY($2::text[])');
    expect(tiktokParams.slice(0, 3)).toEqual([
      'CLIENT-A',
      ['ditbinmas'],
      ['owner'],
    ]);
    expect(tiktokSql).toContain('NULL::text AS url');
  });

  test('Instagram scope includes direct client, junction client, and assigned roles', async () => {
    mockContextAndAccounts([{ platform: 'instagram', username: 'owner' }]);
    query.mockResolvedValueOnce({ rows: [] });
    await getPendingContentForUser('user-1', filters);
    const [instagramSql] = query.mock.calls[2];
    expect(instagramSql).toContain('FROM insta_post_clients');
    expect(instagramSql).toContain('FROM insta_post_roles');
    expect(instagramSql).toContain('LOWER(p.client_id) = LOWER($1)');
  });
});
