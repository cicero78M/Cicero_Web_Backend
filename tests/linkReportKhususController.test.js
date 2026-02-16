import { jest } from '@jest/globals';

const mockCreateLinkReport = jest.fn();
const mockResolveClientIdForLinkReportKhusus = jest.fn();
const mockFindClientIdByUserId = jest.fn();

jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  createLinkReport: mockCreateLinkReport,
}));


jest.unstable_mockModule('../src/service/userClientService.js', () => ({
  resolveClientIdForLinkReportKhusus: mockResolveClientIdForLinkReportKhusus,
}));

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  findClientIdByUserId: mockFindClientIdByUserId,
}));

jest.unstable_mockModule('../src/middleware/debugHandler.js', () => ({
  sendDebug: jest.fn(),
}));

let createLinkReport;

beforeAll(async () => {
  ({ createLinkReport } = await import('../src/controller/linkReportKhususController.js'));
});

beforeEach(() => {
  mockCreateLinkReport.mockReset();
  mockResolveClientIdForLinkReportKhusus.mockReset();
  mockFindClientIdByUserId.mockReset();

  mockResolveClientIdForLinkReportKhusus.mockResolvedValue('POLRES');
});

describe('createLinkReport branching', () => {
  test('IG-only sukses: ekstrak shortcode dan simpan laporan', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    mockCreateLinkReport.mockResolvedValueOnce({ shortcode: 'ABC123', instagram_link: instagramUrl });

    const req = {
      body: { instagram_link: instagramUrl },
      user: { role: 'user', user_id: 'u-1' },
      query: {},
      method: 'POST',
      originalUrl: '/api/link-reports-khusus',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcode: 'ABC123',
        instagram_link: instagramUrl,
        user_id: 'u-1',
        client_id: 'POLRES',
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('non-IG ditolak: instagram_link wajib', async () => {
    const req = {
      body: {
        facebook_link: 'https://facebook.com/post/123',
      },
      user: { role: 'user', user_id: 'u-1' },
      query: {},
      method: 'POST',
      originalUrl: '/api/link-reports-khusus',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockCreateLinkReport).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'instagram_link wajib diisi sebagai referensi tugas khusus',
      })
    );
  });

  test('semua link kosong gagal 400', async () => {
    const req = {
      body: { assignment_id: 'task-001' },
      user: { role: 'user', user_id: 'u-1' },
      query: {},
      method: 'POST',
      originalUrl: '/api/link-reports-khusus',
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'At least one social media link is required',
      })
    );
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });
});
