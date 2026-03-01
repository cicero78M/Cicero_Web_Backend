import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

const verifyDashboardOrClientToken = jest.fn((req, _res, next) => {
  req.user = { client_id: 'NGAWI', client_ids: ['NGAWI'] };
  next();
});

const getInstaRekapLikes = jest.fn((_req, res) => {
  res.status(200).json({ success: true });
});

jest.unstable_mockModule('../src/middleware/dashboardAuth.js', () => ({
  verifyDashboardOrClientToken,
}));

jest.unstable_mockModule('../src/controller/instaController.js', () => ({
  getInstaRekapLikes,
  getInstaPosts: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getInstaPostsKhusus: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getRapidInstagramPosts: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getRapidInstagramProfile: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getRapidInstagramInfo: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getInstagramProfile: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getInstagramUser: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getRapidInstagramPostsStore: jest.fn((_req, res) => res.status(200).json({ success: true })),
  getRapidInstagramPostsByMonth: jest.fn((_req, res) => res.status(200).json({ success: true })),
}));

const { default: instaRoutes } = await import('../src/routes/instaRoutes.js');

describe('insta routes auth middleware', () => {
  beforeEach(() => {
    verifyDashboardOrClientToken.mockClear();
    getInstaRekapLikes.mockClear();
  });

  test('uses verifyDashboardOrClientToken before rekap-likes handler', async () => {
    const app = express();
    app.use('/api/insta', instaRoutes);

    const res = await request(app)
      .get('/api/insta/rekap-likes?client_id=DITBINMAS&scope=ORG&role=ditbinmas');

    expect(res.status).toBe(200);
    expect(verifyDashboardOrClientToken).toHaveBeenCalledTimes(1);
    expect(getInstaRekapLikes).toHaveBeenCalledTimes(1);

    const calledReq = getInstaRekapLikes.mock.calls[0][0];
    expect(calledReq.user).toEqual({ client_id: 'NGAWI', client_ids: ['NGAWI'] });
  });
});
