import { jest } from '@jest/globals';

const mockAxiosGet = jest.fn();

jest.unstable_mockModule('axios', () => ({
  default: { get: mockAxiosGet },
}));

const {
  buildTikTokPostUrl,
  enrichTikTokPostThumbnails,
  findExistingTikTokThumbnail,
} = await import('../../src/service/tiktokThumbnailService.js');

describe('tiktokThumbnailService', () => {
  beforeEach(() => {
    mockAxiosGet.mockReset();
  });

  test('reads nested TikTok thumbnail payloads', () => {
    expect(
      findExistingTikTokThumbnail({
        video: { cover: { url_list: ['https://cdn.test/cover.jpg'] } },
      }),
    ).toBe('https://cdn.test/cover.jpg');
  });

  test('builds a safe canonical TikTok post URL', () => {
    expect(buildTikTokPostUrl('@cicero.test', '7123456789012345678')).toBe(
      'https://www.tiktok.com/@cicero.test/video/7123456789012345678',
    );
    expect(buildTikTokPostUrl('bad/user', '7123456789012345678')).toBe('');
  });

  test('enriches database posts with current TikTok metrics', async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        code: 0,
        data: {
          cover: 'https://cdn.test/tikwm.jpg',
          play_count: 3210,
          digg_count: 120,
          comment_count: 30,
          share_count: 4,
        },
      },
    });

    const result = await enrichTikTokPostThumbnails(
      [{ video_id: '7123456789012345678', caption: 'Example' }],
      'cicero.test',
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://www.tikwm.com/api/',
      expect.objectContaining({
        params: {
          url: 'https://www.tiktok.com/@cicero.test/video/7123456789012345678',
          hd: 0,
        },
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        thumbnail_url: 'https://cdn.test/tikwm.jpg',
        view_count: 3210,
        like_count: 120,
        comment_count: 30,
        share_count: 4,
        url: 'https://www.tiktok.com/@cicero.test/video/7123456789012345678',
      }),
    );
  });

  test('falls back to official oEmbed when metrics provider is unavailable', async () => {
    mockAxiosGet
      .mockRejectedValueOnce(new Error('metrics timeout'))
      .mockResolvedValueOnce({
        data: { thumbnail_url: 'https://cdn.test/oembed.jpg' },
      });

    const result = await enrichTikTokPostThumbnails(
      [{ video_id: '7123456789012345679' }],
      'cicero.test',
    );

    expect(result[0].thumbnail_url).toBe('https://cdn.test/oembed.jpg');
    expect(result[0].view_count).toBeUndefined();
    expect(result[0].url).toContain('/video/7123456789012345679');
  });
});
