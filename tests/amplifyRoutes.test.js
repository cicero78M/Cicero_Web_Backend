import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const authRequired = (_req, _res, next) => next();

// Mock the controllers
const mockGetAmplifyRekap = jest.fn((req, res) => res.json({ success: true, data: [] }));
const mockExportAmplifyRekapExcel = jest.fn((req, res) => res.status(200).end());
const mockGetAmplifyKhususRekap = jest.fn((req, res) => res.json({ success: true, data: [] }));

jest.unstable_mockModule('../src/controller/amplifyController.js', () => ({
  getAmplifyRekap: mockGetAmplifyRekap,
  exportAmplifyRekapExcel: mockExportAmplifyRekapExcel,
}));

jest.unstable_mockModule('../src/controller/amplifyKhususController.js', () => ({
  getAmplifyKhususRekap: mockGetAmplifyKhususRekap
}));

let amplifyRoutes;

beforeAll(async () => {
  amplifyRoutes = (await import('../src/routes/amplifyRoutes.js')).default;
});

describe('amplifyRoutes', () => {
  let app;

  beforeAll(() => {
    process.env.JWT_SECRET = 'testsecret';
    app = express();
    const router = express.Router();
    // Mount amplify routes at the amplify path, like in the actual app
    router.use('/amplify', amplifyRoutes);
    app.use('/api', authRequired, router);
  });

  beforeEach(() => {
    mockGetAmplifyRekap.mockClear();
    mockGetAmplifyKhususRekap.mockClear();
  });

  test('GET /api/amplify/rekap calls getAmplifyRekap', async () => {
    const res = await request(app)
      .get('/api/amplify/rekap?client_id=TEST');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetAmplifyRekap).toHaveBeenCalled();
  });

  test('GET /api/amplify/rekap-khusus calls getAmplifyKhususRekap', async () => {
    const res = await request(app)
      .get('/api/amplify/rekap-khusus?client_id=TEST');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetAmplifyKhususRekap).toHaveBeenCalled();
  });

  test('operator role can access /api/amplify/rekap', async () => {
    const res = await request(app)
      .get('/api/amplify/rekap?client_id=TEST');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('operator role can access /api/amplify/rekap-khusus', async () => {
    const res = await request(app)
      .get('/api/amplify/rekap-khusus?client_id=TEST');
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
