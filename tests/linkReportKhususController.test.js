import { jest } from '@jest/globals';

// Mock all dependencies
const mockGetLinkReports = jest.fn();
const mockFindLinkReportByShortcode = jest.fn();
const mockCreateLinkReport = jest.fn();
const mockUpdateLinkReport = jest.fn();
const mockDeleteLinkReport = jest.fn();
const mockFetchSinglePostKhusus = jest.fn();
const mockFindClientIdByUserId = jest.fn();

jest.unstable_mockModule('../src/model/linkReportKhususModel.js', () => ({
  getLinkReports: mockGetLinkReports,
  findLinkReportByShortcode: mockFindLinkReportByShortcode,
  createLinkReport: mockCreateLinkReport,
  updateLinkReport: mockUpdateLinkReport,
  deleteLinkReport: mockDeleteLinkReport,
}));

jest.unstable_mockModule('../src/handler/fetchpost/instaFetchPost.js', () => ({
  fetchSinglePostKhusus: mockFetchSinglePostKhusus,
}));

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  findClientIdByUserId: mockFindClientIdByUserId,
}));

let createLinkReport, updateLinkReport;

beforeAll(async () => {
  const controller = await import('../src/controller/linkReportKhususController.js');
  createLinkReport = controller.createLinkReport;
  updateLinkReport = controller.updateLinkReport;
});

beforeEach(() => {
  mockGetLinkReports.mockReset();
  mockFindLinkReportByShortcode.mockReset();
  mockCreateLinkReport.mockReset();
  mockUpdateLinkReport.mockReset();
  mockDeleteLinkReport.mockReset();
  mockFetchSinglePostKhusus.mockReset();
  mockFindClientIdByUserId.mockReset();
  mockFindClientIdByUserId.mockResolvedValue('POLRES');
});

describe('createLinkReport', () => {
  test('uses req.user.client_id when body client_id is missing', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    mockFetchSinglePostKhusus.mockResolvedValueOnce({
      shortcode: 'ABC123',
      caption: 'Test caption'
    });
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: instagramUrl
    });

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'POLRES'
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects when both payload and token client_id are missing', async () => {
    const req = {
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        user_id: '1'
      },
      query: {}
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'client_id is required',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when requested client_id is outside req.user.client_ids', async () => {
    const req = {
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        user_id: '1',
        client_id: 'POLRES_B'
      },
      user: {
        client_id: 'POLRES_A',
        client_ids: ['POLRES_A']
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'client_id tidak diizinkan',
        statusCode: 403
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when all social media links are missing', async () => {
    const req = {
      body: { user_id: '1', client_id: 'POLRES', shortcode: 'ABC123' },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Minimal satu link laporan yang valid harus dikirim',
        statusCode: 400,
        reasonCode: 'VALIDATION_AT_LEAST_ONE_VALID_LINK_REQUIRED'
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when instagram_link is not a valid Instagram URL', async () => {
    const req = {
      body: {
        instagram_link: 'https://facebook.com/post/123',
        user_id: '1',
        client_id: 'POLRES'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {};

    await createLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'instagram_link must be a valid Instagram post URL',
        statusCode: 400
      })
    );
    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('accepts non-instagram links when shortcode is provided', async () => {
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: null,
      facebook_link: 'https://facebook.com/post/123'
    });

    const req = {
      body: {
        facebook_link: ' https://facebook.com/post/123 ',
        twitter_link: 'not-a-url',
        user_id: '1',
        client_id: 'POLRES',
        shortcode: 'ABC123'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).not.toHaveBeenCalled();
    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        shortcode: 'ABC123',
        instagram_link: null,
        facebook_link: 'https://facebook.com/post/123',
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects non-instagram-only payload when shortcode is missing', async () => {
    const req = {
      body: {
        facebook_link: 'https://facebook.com/post/123',
        user_id: '1',
        client_id: 'POLRES'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const next = jest.fn();

    await createLinkReport(req, {}, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'shortcode is required when instagram_link is not provided',
        statusCode: 400,
        reasonCode: 'VALIDATION_SHORTCODE_REQUIRED_WITHOUT_INSTAGRAM_LINK'
      })
    );
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });

  test('creates link report after successful metadata fetch', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    const expectedShortcode = 'ABC123';
    mockFetchSinglePostKhusus.mockResolvedValueOnce({
      shortcode: expectedShortcode,
      caption: 'Test caption'
    });
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: expectedShortcode,
      instagram_link: instagramUrl
    });

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(mockCreateLinkReport).toHaveBeenCalledWith(
      expect.objectContaining({
        instagram_link: instagramUrl,
        shortcode: expectedShortcode,
        user_id: '1',
        client_id: 'POLRES'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts Instagram reel URLs', async () => {
    const instagramUrl = 'https://www.instagram.com/reel/ABC123/';
    mockFetchSinglePostKhusus.mockResolvedValueOnce({
      shortcode: 'ABC123',
      caption: 'Test reel'
    });
    mockCreateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: instagramUrl
    });

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(mockCreateLinkReport).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('handles RapidAPI fetch errors', async () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123/';
    const error = new Error('RapidAPI error');
    mockFetchSinglePostKhusus.mockRejectedValueOnce(error);

    const req = {
      body: {
        instagram_link: instagramUrl,
        user_id: '1',
        client_id: 'POLRES'
      },
      user: {
        role: 'user',
        user_id: '1',
        client_id: 'POLRES'
      }
    };
    const res = {};
    const next = jest.fn();

    await createLinkReport(req, res, next);

    expect(mockFetchSinglePostKhusus).toHaveBeenCalledWith(instagramUrl, 'POLRES');
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Gagal mengambil data Instagram post',
        statusCode: 503,
        reasonCode: 'FETCH_IG_UNKNOWN'
      })
    );
    expect(mockCreateLinkReport).not.toHaveBeenCalled();
  });
});

describe('updateLinkReport', () => {
  test('rejects when instagram_link is invalid', async () => {
    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: 'https://facebook.com/post/123',
        user_id: '1'
      }
    };
    const next = jest.fn();
    const res = {};

    await updateLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'instagram_link must be a valid Instagram post URL',
        statusCode: 400
      })
    );
    expect(mockUpdateLinkReport).not.toHaveBeenCalled();
  });

  test('rejects when other social media links are provided', async () => {
    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: 'https://www.instagram.com/p/ABC123/',
        twitter_link: 'https://twitter.com/post/123',
        user_id: '1'
      }
    };
    const next = jest.fn();
    const res = {};

    await updateLinkReport(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Only instagram_link is allowed for special assignment updates',
        statusCode: 400
      })
    );
    expect(mockUpdateLinkReport).not.toHaveBeenCalled();
  });

  test('updates with valid Instagram link', async () => {
    const instagramUrl = 'https://www.instagram.com/p/XYZ789/';
    mockUpdateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123',
      instagram_link: instagramUrl
    });

    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        instagram_link: instagramUrl,
        user_id: '1'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await updateLinkReport(req, res, next);

    expect(mockUpdateLinkReport).toHaveBeenCalledWith(
      'ABC123',
      '1',
      expect.objectContaining({
        instagram_link: instagramUrl,
        facebook_link: null,
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('allows update without instagram_link', async () => {
    mockUpdateLinkReport.mockResolvedValueOnce({
      shortcode: 'ABC123'
    });

    const req = {
      params: { shortcode: 'ABC123' },
      body: {
        user_id: '1'
      }
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
    const next = jest.fn();

    await updateLinkReport(req, res, next);

    expect(mockUpdateLinkReport).toHaveBeenCalledWith(
      'ABC123',
      '1',
      expect.objectContaining({
        facebook_link: null,
        twitter_link: null,
        tiktok_link: null,
        youtube_link: null
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
