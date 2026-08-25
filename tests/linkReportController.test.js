import { jest } from '@jest/globals';

const mockFindDuplicateLinks = jest.fn();
const mockGetLinkReports = jest.fn();
const mockCreateRegularLinkReport = jest.fn();
const mockUpdateRegularLinkReport = jest.fn();
const mockDeleteRegularLinkReport = jest.fn();
const mockFindSpecialDuplicateLinks = jest.fn();
const mockCreateSpecialLinkReport = jest.fn();
const mockUpdateSpecialLinkReport = jest.fn();
const mockDeleteSpecialLinkReport = jest.fn();
const mockFindSpecialPost = jest.fn();

jest.unstable_mockModule('../src/model/linkReportModel.js', () => ({
  findDuplicateLinks: mockFindDuplicateLinks,
  getLinkReports: mockGetLinkReports,
  createLinkReport: mockCreateRegularLinkReport,
  updateLinkReport: mockUpdateRegularLinkReport,
  deleteLinkReport: mockDeleteRegularLinkReport,
}));

jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  findDuplicateLinks: mockFindSpecialDuplicateLinks,
  createLinkReport: mockCreateSpecialLinkReport,
  updateLinkReport: mockUpdateSpecialLinkReport,
  deleteLinkReport: mockDeleteSpecialLinkReport,
}));

jest.unstable_mockModule('../src/model/instaPostKhususModel.js', () => ({
  findPostByShortcodeInsensitive: mockFindSpecialPost,
}));

let getAllLinkReports;
let createLinkReport;
let updateLinkReport;
let deleteLinkReport;

beforeAll(async () => {
  ({
    getAllLinkReports,
    createLinkReport,
    updateLinkReport,
    deleteLinkReport,
  } = await import('../src/controller/linkReportController.js'));
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFindDuplicateLinks.mockResolvedValue([]);
  mockFindSpecialDuplicateLinks.mockResolvedValue([]);
  mockFindSpecialPost.mockResolvedValue(null);
});

describe('linkReportController.getAllLinkReports', () => {
  test('returns duplicates when links[] query is provided', async () => {
    mockFindDuplicateLinks.mockResolvedValueOnce(['https://instagram.com/p/abc']);
    mockFindSpecialDuplicateLinks.mockResolvedValueOnce(['https://instagram.com/p/xyz']);

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
      data: {
        duplicates: [
          'https://instagram.com/p/abc',
          'https://instagram.com/p/xyz',
        ],
      },
    });
  });
});

function createResponse() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('linkReportController mutation routing', () => {
  const authenticatedUser = { role: 'user', user_id: 'user-1' };

  test('routes a special shortcode submitted through the regular endpoint', async () => {
    mockFindSpecialPost.mockResolvedValueOnce({ shortcode: 'SPECIAL01' });
    mockCreateSpecialLinkReport.mockResolvedValueOnce({
      shortcode: 'SPECIAL01',
      user_id: 'user-1',
    });
    const req = {
      body: { shortcode: 'SPECIAL01', instagram_link: 'https://instagram.com/p/SPECIAL01/' },
      user: authenticatedUser,
    };
    const res = createResponse();

    await createLinkReport(req, res);

    expect(mockCreateSpecialLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({ shortcode: 'SPECIAL01', user_id: 'user-1' })
    );
    expect(mockCreateRegularLinkReport).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('keeps a regular shortcode in the regular report table', async () => {
    mockCreateRegularLinkReport.mockResolvedValueOnce({
      shortcode: 'REGULAR01',
      user_id: 'user-1',
    });
    const req = { body: { shortcode: 'REGULAR01' }, user: authenticatedUser };
    const res = createResponse();

    await createLinkReport(req, res);

    expect(mockCreateRegularLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({ shortcode: 'REGULAR01', user_id: 'user-1' })
    );
    expect(mockCreateSpecialLinkReport).not.toHaveBeenCalled();
  });

  test('routes update and delete for special shortcodes', async () => {
    mockFindSpecialPost.mockResolvedValue({ shortcode: 'SPECIAL01' });
    mockUpdateSpecialLinkReport.mockResolvedValueOnce({ shortcode: 'SPECIAL01' });
    mockDeleteSpecialLinkReport.mockResolvedValueOnce({ shortcode: 'SPECIAL01' });
    const updateRes = createResponse();
    const deleteRes = createResponse();

    await updateLinkReport(
      { params: { shortcode: 'SPECIAL01' }, body: {}, user: authenticatedUser },
      updateRes,
      jest.fn()
    );
    await deleteLinkReport(
      { params: { shortcode: 'SPECIAL01' }, query: {}, user: authenticatedUser },
      deleteRes,
      jest.fn()
    );

    expect(mockUpdateSpecialLinkReport).toHaveBeenCalledWith('SPECIAL01', 'user-1', {});
    expect(mockDeleteSpecialLinkReport).toHaveBeenCalledWith('SPECIAL01', 'user-1');
    expect(mockUpdateRegularLinkReport).not.toHaveBeenCalled();
    expect(mockDeleteRegularLinkReport).not.toHaveBeenCalled();
  });
});
