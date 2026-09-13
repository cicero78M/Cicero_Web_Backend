import { jest } from '@jest/globals';

const fetchMock = jest.fn();

jest.unstable_mockModule('../src/config/env.js', () => ({
  env: {
    RAPIDAPI_KEY: 'test-key',
    RAPIDAPI_FALLBACK_KEY: '',
    RAPIDAPI_FALLBACK_HOST: '',
    DEBUG_FETCH_INSTAGRAM: false,
  },
}));

global.fetch = fetchMock;

const { fetchInstagramPostsPageToken } = await import(
  '../src/service/instaRapidService.js'
);

beforeEach(() => fetchMock.mockReset());

test('RapidAPI posts request always carries an abort signal', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { items: [] } }),
  });

  await fetchInstagramPostsPageToken('cicero');

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/v1/posts?'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test('RapidAPI timeout is exposed as a gateway timeout', async () => {
  fetchMock.mockRejectedValue(
    Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
  );

  await expect(fetchInstagramPostsPageToken('cicero')).rejects.toMatchObject({
    code: 'RAPIDAPI_TIMEOUT',
    statusCode: 504,
  });
});
