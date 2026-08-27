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

  test('enriches database posts through official TikTok oEmbed', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { thumbnail_url: 'https://cdn.test/oembed.jpg' },
    });

    const result = await enrichTikTokPostThumbnails(
      [{ video_id: '7123456789012345678', caption: 'Example' }],
      'cicero.test',
    );

    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://www.tiktok.com/oembed',
      expect.objectContaining({
        params: {
          url: 'https://www.tiktok.com/@cicero.test/video/7123456789012345678',
        },
      }),
    );
    expect(result[0]).toEqual(
      expect.objectContaining({
        thumbnail_url: 'https://cdn.test/oembed.jpg',
        url: 'https://www.tiktok.com/@cicero.test/video/7123456789012345678',
      }),
    );
  });

  test('keeps the post usable when oEmbed is unavailable', async () => {
    mockAxiosGet.mockRejectedValue(new Error('timeout'));

    const result = await enrichTikTokPostThumbnails(
      [{ video_id: '7123456789012345679' }],
      'cicero.test',
    );

    expect(result[0].thumbnail_url).toBeUndefined();
    expect(result[0].url).toContain('/video/7123456789012345679');
  });
});
