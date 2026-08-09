import { jest } from '@jest/globals';

const mockFindById = jest.fn();
const mockIsChildClientOf = jest.fn();

jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findById: mockFindById,
  isChildClientOf: mockIsChildClientOf,
}));

const { authorizeReportRequest } = await import(
  '../src/service/reportAuthorizationService.js'
);

function request(query = {}, user = {}, headers = {}) {
  return { query, user, headers, body: {} };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindById.mockResolvedValue(null);
  mockIsChildClientOf.mockResolvedValue(false);
});

test.each([
  ['client B', { client_id: 'B' }, {}],
  ['role=B', { client_id: 'B', role: 'B' }, {}],
  ['case variation', { client_id: 'b' }, {}],
  ['X-Client-Id', {}, { 'x-client-id': 'B' }],
])('single-client A rejects %s', async (_label, query, headers) => {
  const result = await authorizeReportRequest(
    request(
      query,
      { client_id: 'A', client_ids: ['A'], role: 'operator' },
      headers
    )
  );
  expect(result.error).toEqual({
    status: 403,
    message: 'client_id tidak diizinkan',
  });
});

test('multi-client token rejects a client outside its rehydrated assignments', async () => {
  const result = await authorizeReportRequest(
    request(
      { client_id: 'C', role: 'C' },
      { client_ids: ['A', 'B'], role: 'operator' }
    )
  );
  expect(result.error?.status).toBe(403);
});

test('explicit assigned client takes precedence over the primary client', async () => {
  const result = await authorizeReportRequest(
    request({ client_id: 'B' }, { client_id: 'A', client_ids: ['A', 'B'] })
  );
  expect(result).toMatchObject({ clientId: 'B' });
});

test('multi-client token without a primary client requires an explicit selection', async () => {
  const result = await authorizeReportRequest(
    request({}, { client_ids: ['A', 'B'] })
  );
  expect(result.error).toEqual({
    status: 400,
    message: 'client_id wajib diisi',
  });
});

test('single assigned client is used when the token has no primary client', async () => {
  const result = await authorizeReportRequest(
    request({}, { client_ids: ['A'] })
  );
  expect(result).toMatchObject({ clientId: 'A' });
});

test('direktorat scope rejects an unverified child relationship', async () => {
  mockFindById.mockResolvedValue({
    client_id: 'DITBINMAS',
    client_type: 'direktorat',
  });
  const result = await authorizeReportRequest(
    request(
      { client_id: 'POLRES_B', scope: 'direktorat', role: 'POLRES_B' },
      { client_ids: ['DITBINMAS'], role: 'ditbinmas' }
    )
  );
  expect(mockIsChildClientOf).toHaveBeenCalledWith('POLRES_B', 'DITBINMAS');
  expect(result.error?.status).toBe(403);
});

test('direktorat scope accepts a database-verified child relationship', async () => {
  mockFindById.mockResolvedValue({
    client_id: 'DITBINMAS',
    client_type: 'direktorat',
  });
  mockIsChildClientOf.mockResolvedValue(true);
  const result = await authorizeReportRequest(
    request(
      { client_id: 'POLRES_A', scope: 'direktorat' },
      { client_ids: ['DITBINMAS'], role: 'ditbinmas' }
    )
  );
  expect(result).toMatchObject({ clientId: 'POLRES_A', role: 'ditbinmas' });
});
