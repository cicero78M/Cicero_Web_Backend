import { jest } from '@jest/globals';

const mockGetRekap = jest.fn();
jest.unstable_mockModule('../src/model/linkReportModel.js', () => ({
  getRekapLinkByClient: mockGetRekap,
}));
jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendConsoleDebug: jest.fn(),
}));
jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findById: jest.fn(),
  isChildClientOf: jest.fn(),
}));

let getAmplifyRekap;
beforeAll(async () => {
  ({ getAmplifyRekap } = await import(
    '../src/controller/amplifyController.js'
  ));
});

beforeEach(() => {
  mockGetRekap.mockReset();
});

test('accepts tanggal_mulai and tanggal_selesai', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = {
    query: {
      client_id: 'c1',
      periode: 'harian',
      tanggal_mulai: '2024-01-01',
      tanggal_selesai: '2024-01-31',
    },
    user: { client_id: 'c1' },
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyRekap(req, res);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'C1',
    'harian',
    undefined,
    '2024-01-01',
    '2024-01-31',
    undefined,
    { regionalId: null }
  );
  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({ chartHeight: 300 })
  );
});

test('returns 403 when client_id unauthorized', async () => {
  const req = {
    query: { client_id: 'c2' },
    user: { client_ids: ['c1'] },
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyRekap(req, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(json).toHaveBeenCalledWith({
    success: false,
    message: 'client_id tidak diizinkan',
  });
  expect(mockGetRekap).not.toHaveBeenCalled();
});

test('allows authorized client_id', async () => {
  mockGetRekap.mockResolvedValue([]);
  const req = {
    query: { client_id: 'c1' },
    user: { client_ids: ['c1', 'c2'] },
  };
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnThis() };
  await getAmplifyRekap(req, res);
  expect(res.status).not.toHaveBeenCalledWith(403);
  expect(mockGetRekap).toHaveBeenCalledWith(
    'C1',
    'harian',
    undefined,
    undefined,
    undefined,
    undefined,
    { regionalId: null }
  );
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});

test.each([
  ['B', 200],
  ['C', 403],
])(
  'multi-client token requesting %s returns %i',
  async (clientId, expectedStatus) => {
    mockGetRekap.mockResolvedValue([]);
    const req = {
      query: { client_id: clientId },
      user: { client_id: 'A', client_ids: ['A', 'B'] },
    };
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnThis() };

    await getAmplifyRekap(req, res);

    if (expectedStatus === 403) {
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockGetRekap).not.toHaveBeenCalled();
    } else {
      expect(res.status).not.toHaveBeenCalledWith(403);
      expect(mockGetRekap).toHaveBeenCalledWith(
        'B',
        'harian',
        undefined,
        undefined,
        undefined,
        undefined,
        { regionalId: null }
      );
    }
  }
);
