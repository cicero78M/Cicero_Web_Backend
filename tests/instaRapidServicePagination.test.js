import { jest } from '@jest/globals';

const mockFetch = jest.fn();
const mockAxiosGet = jest.fn();

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch,
}));

jest.unstable_mockModule('axios', () => ({
  default: {
    get: mockAxiosGet,
  },
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'test-key';

let fetchInstagramPosts;
let fetchInstagramPostsPageToken;

beforeAll(async () => {
  ({ fetchInstagramPosts, fetchInstagramPostsPageToken } = await import('../src/service/instaRapidService.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('fetchInstagramPostsPageToken membaca pagination nested payload', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        items: [{ id: '1' }],
        pagination_token: 'nested-token',
        has_more: true,
      },
    }),
  });

  const result = await fetchInstagramPostsPageToken('polri');

  expect(result).toEqual({
    items: [{ id: '1' }],
    next_token: 'nested-token',
    has_more: true,
  });
});

test('fetchInstagramPostsPageToken fallback ke token top-level dan next_cursor', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        items: [{ id: '1' }],
      },
      next_cursor: 'cursor-top-level',
      has_more: true,
    }),
  });

  const result = await fetchInstagramPostsPageToken('polri', 'prev-token');

  expect(result).toEqual({
    items: [{ id: '1' }],
    next_token: 'cursor-top-level',
    has_more: true,
  });
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch.mock.calls[0][0]).toContain('pagination_token=prev-token');
});

test('fetchInstagramPosts loop sampai limit tercapai meski token masih ada', async () => {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [{ id: '1' }],
          pagination_token: 'token-1',
          has_more: true,
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [{ id: '2' }],
          end_cursor: 'token-2',
          has_more: true,
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          items: [{ id: '3' }],
        },
      }),
    });

  const items = await fetchInstagramPosts('polri', 2);

  expect(items).toEqual([{ id: '1' }, { id: '2' }]);
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
