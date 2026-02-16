import { jest } from '@jest/globals';

const mockCreateLinkReport = jest.fn();
const mockFetchSinglePostKhusus = jest.fn();
const mockResolveClientIdForLinkReportKhusus = jest.fn();
const mockFindClientIdByUserId = jest.fn();

jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  createLinkReport: mockCreateLinkReport,
}));

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: mockFetchSinglePostKhusus,
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
  mockFetchSinglePostKhusus.mockReset();
  mockResolveClientIdForLinkReportKhusus.mockReset();
  mockFindClientIdByUserId.mockReset();

  mockResolveClientIdForLinkReportKhusus.mockResolvedValue('POLRES');
});

describe('createLinkReport branching', () => {
  test('IG-only sukses: jalankan shortcode extraction + fetchSinglePostKhusus', async () => {
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

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
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

  test('non-IG-only sukses: skip extract shortcode + skip fetchSinglePostKhusus', async () => {
    mockCreateLinkReport.mockResolvedValueOnce({
      assignment_id: 'task-001',
      user_id: 'u-1',
      facebook_link: 'https://facebook.com/post/123',
    });

    const req = {
      body: {
        assignment_id: 'task-001',
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

    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment_id: 'task-001',
        shortcode: null,
        facebook_link: 'https://facebook.com/post/123',
        user_id: 'u-1',
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
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
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });
});
