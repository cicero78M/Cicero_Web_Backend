import { jest } from '@jest/globals';

const mockFindDuplicateLinks = jest.fn();
const mockGetLinkReports = jest.fn();

jest.unstable_mockModule('../src/model/linkReportModel.js', () => ({
  findDuplicateLinks: mockFindDuplicateLinks,
  getLinkReports: mockGetLinkReports,
}));

let getAllLinkReports;

beforeAll(async () => {
  ({ getAllLinkReports } = await import('../src/controller/linkReportController.js'));
});

beforeEach(() => {
  mockFindDuplicateLinks.mockReset();
  mockGetLinkReports.mockReset();
});

describe('linkReportController.getAllLinkReports', () => {
  test('returns duplicates when links[] query is provided', async () => {
    mockFindDuplicateLinks.mockResolvedValueOnce(['https://instagram.com/p/abc']);

    const req = {
      query: {
        'links[]': ['https://instagram.com/p/abc', 'https://instagram.com/p/xyz'],
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await getAllLinkReports(req, res, next);

    expect(mockFindDuplicateLinks).toHaveBeenCalledTimes(1);
    expect(mockGetLinkReports).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { duplicates: ['https://instagram.com/p/abc'] },
    });
  });
});
