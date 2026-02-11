import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createProtectedApiClient } from '../../src/service/protectedApiClient.js';

describe('protectedApiClient smoke test', () => {
  let server;
  let baseURL;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'testsecret';

    const app = express();
    app.use(express.json());

    app.post('/api/auth/user-login', (req, res) => {
      const { nrp } = req.body;
      const token = jwt.sign({ user_id: nrp, role: 'user' }, process.env.JWT_SECRET);
      return res.status(200).json({
        success: true,
        token,
        user: { user_id: nrp, role: 'user' }
      });
    });

    app.use('/api', (req, res, next) => {
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      return next();
    });

    app.post('/api/link-reports', (req, res) => {
      return res.status(200).json({ success: true, endpoint: 'link-reports' });
    });

    app.post('/api/link-reports-khusus', (req, res) => {
      return res.status(200).json({ success: true, endpoint: 'link-reports-khusus' });
    });

    app.get('/api/users/:id', (req, res) => {
      return res.status(200).json({ success: true, user_id: req.params.id });
    });

    await new Promise(resolve => {
      server = app.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    baseURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve, reject) => {
      server.close(err => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  });

  test('login lalu call /api/users/:id mengembalikan 200 dengan bearer token', async () => {
    const logger = { info: jest.fn() };
    const client = createProtectedApiClient({ baseURL, logger });

    const loginResponse = await client.userLogin({
      nrp: 'u100',
      whatsapp: '08123456789'
    });

    expect(loginResponse.success).toBe(true);
    expect(client.getToken()).toBeTruthy();

    const userResponse = await client.getUserById('u100');
    expect(userResponse.status).toBe(200);
    expect(userResponse.data.success).toBe(true);

    await client.createLinkReport({ shortcode: 'abc123' });
    await client.createLinkReportKhusus({ shortcode: 'xyz789' });

    const requestLogs = logger.info.mock.calls
      .filter(call => call[0] === '[API CLIENT] Outgoing request')
      .map(call => call[1]);

    const protectedLogs = requestLogs.filter(
      payload => payload.url.includes('/api/users/')
        || payload.url.includes('/api/link-reports')
    );

    expect(protectedLogs.length).toBe(3);
    for (const payload of protectedLogs) {
      expect(payload.authorizationAttached).toBe(true);
      expect(payload.withCredentials).toBe(true);
      expect(payload.authorizationPreview).toMatch(/^Bearer\s.+/);
    }
  });
});
