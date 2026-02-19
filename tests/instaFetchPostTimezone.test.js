import { jest } from '@jest/globals';

describe('fetchAndStoreInstaContent Jakarta daily boundary', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
  });

  test('uses consistent Jakarta date for select/delete/summary and matches isTodayJakarta filter near 00:00 WIB', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-03-15T17:05:00.000Z')); // 00:05 WIB (next day)

    const expectedJakartaDate = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Jakarta',
    });

    const postBeforeJakartaMidnight = {
      code: 'old-day',
      taken_at: Math.floor(new Date('2024-03-15T16:55:00.000Z').getTime() / 1000), // 23:55 WIB
      comment_count: 1,
      like_count: 2,
      caption: 'old',
    };
    const postAfterJakartaMidnight = {
      code: 'new-day',
      taken_at: Math.floor(new Date('2024-03-15T17:01:00.000Z').getTime() / 1000), // 00:01 WIB
      comment_count: 3,
      like_count: 4,
      caption: 'new',
    };

    const mockQuery = jest.fn(async (sql, params = []) => {
      if (sql.includes('FROM clients')) {
        return {
          rows: [{ id: 'CLIENT_1', client_insta: 'account_a' }],
        };
      }
      if (sql.startsWith('SELECT shortcode FROM insta_post') && sql.includes('is_missing_since IS NULL')) {
        return { rows: [{ shortcode: 'stale-shortcode' }] };
      }
      if (sql.startsWith('INSERT INTO insta_post')) {
        return { rows: [] };
      }
      if (sql.startsWith('UPDATE insta_post')) {
        return { rowCount: 1, rows: [{ shortcode: 'stale-shortcode' }] };
      }
      if (sql.startsWith('SELECT shortcode') && sql.includes('is_missing_since IS NOT NULL')) {
        return { rows: [] };
      }
      if (sql.startsWith('SELECT shortcode FROM insta_post WHERE client_id = $1')) {
        return { rows: [{ shortcode: 'new-day' }] };
      }
      if (sql.startsWith('SELECT shortcode, created_at FROM insta_post')) {
        return { rows: [{ shortcode: 'new-day', created_at: new Date('2024-03-15T17:01:00.000Z') }] };
      }
      return { rows: [] };
    });

    const mockSendDebug = jest.fn();
    const mockSavePostWithMedia = jest.fn().mockResolvedValue();

    jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));
    jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({ sendDebug: mockSendDebug }));
    jest.unstable_mockModule('../src/service/instagramApi.js', () => ({
      fetchInstagramPostsWithQuality: jest.fn().mockResolvedValue({
        items: [postBeforeJakartaMidnight, postAfterJakartaMidnight],
        isCompleteFetch: true,
        fetchMeta: { pagesFetched: 1, endedByLimit: false },
      }),
      fetchInstagramPostInfo: jest.fn(),
    }));
    jest.unstable_mockModule('../src/model/instaPostExtendedModel.js', () => ({
      savePostWithMedia: mockSavePostWithMedia,
    }));
    jest.unstable_mockModule('../src/model/instaPostKhususModel.js', () => ({
      upsertInstaPost: jest.fn(),
    }));
    jest.unstable_mockModule('../src/utils/utilsHelper.js', () => ({
      extractInstagramShortcode: jest.fn(),
    }));

    const { fetchAndStoreInstaContent } = await import('../src/handler/fetchpost/instaFetchPost.js');

    const summary = await fetchAndStoreInstaContent([]);

    expect(summary.CLIENT_1.count).toBe(1);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $1"),
      [expectedJakartaDate, 'CLIENT_1']
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $3"),
      [['stale-shortcode'], 'CLIENT_1', expectedJakartaDate]
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $2"),
      ['CLIENT_1', expectedJakartaDate]
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT shortcode, created_at FROM insta_post WHERE DATE((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Jakarta') = $1"),
      [expectedJakartaDate]
    );

    expect(mockSavePostWithMedia).toHaveBeenCalledTimes(1);
    expect(mockSendDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Jumlah post IG HARI INI SAJA: 1'),
      })
    );
  });
});
