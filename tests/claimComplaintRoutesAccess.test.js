import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

describe('claim complaint route role access', () => {
  let app;
  let handlers;

  beforeEach(async () => {
    jest.resetModules();
    handlers = {
      triageClaimComplaint: jest.fn((_req, res) => res.sendStatus(204)),
      getClaimComplaints: jest.fn((_req, res) => res.sendStatus(204)),
      escalateClaimComplaint: jest.fn((_req, res) => res.sendStatus(204)),
      resolveClaimComplaint: jest.fn((_req, res) => res.sendStatus(204)),
    };

    jest.unstable_mockModule('../src/middleware/authMiddleware.js', () => ({
      authRequired: (req, _res, next) => {
        req.user = {
          user_id: req.get('x-test-user-id') || '1001',
          role: req.get('x-test-role') || '',
        };
        return next();
      },
    }));
    jest.unstable_mockModule('../src/controller/claimController.js', () => ({
      confirmClaimPasswordReset: jest.fn(),
      requestClaimPasswordReset: jest.fn(),
      verifyClaimPasswordResetOtp: jest.fn(),
      registerClaimCredentials: jest.fn(),
      getUserData: jest.fn(),
      getClaimMe: jest.fn(),
      updateUserData: jest.fn(),
      updateClaimMe: jest.fn(),
      getPendingContent: jest.fn(),
      validateClaimSocialProfile: jest.fn(),
    }));
    jest.unstable_mockModule(
      '../src/controller/claimComplaintController.js',
      () => ({ triageClaimComplaint: handlers.triageClaimComplaint })
    );
    jest.unstable_mockModule(
      '../src/controller/claimComplaintLifecycleController.js',
      () => ({
        getClaimComplaints: handlers.getClaimComplaints,
        escalateClaimComplaint: handlers.escalateClaimComplaint,
        resolveClaimComplaint: handlers.resolveClaimComplaint,
      })
    );

    const { default: claimRoutes } = await import(
      '../src/routes/claimRoutes.js'
    );
    app = express();
    app.use(express.json());
    app.use('/api/claim', claimRoutes);
  });

  const complaintRoutes = [
    ['post', '/api/claim/complaints/triage', 'triageClaimComplaint'],
    ['get', '/api/claim/complaints', 'getClaimComplaints'],
    ['get', '/api/claim/complaints/complaint-1', 'getClaimComplaints'],
    [
      'post',
      '/api/claim/complaints/complaint-1/escalate',
      'escalateClaimComplaint',
    ],
    [
      'post',
      '/api/claim/complaints/complaint-1/resolve',
      'resolveClaimComplaint',
    ],
  ];

  test.each(complaintRoutes)(
    'allows user role on %s %s',
    async (method, path, handlerName) => {
      const response = await request(app)
        [method](path)
        .set('x-test-role', 'UsEr');

      expect(response.status).toBe(204);
      expect(handlers[handlerName]).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ user_id: '1001', role: 'UsEr' }),
        }),
        expect.anything(),
        expect.anything()
      );
    }
  );

  test.each(['operator', 'dashboard', 'admin', ''])(
    'rejects %s role before complaint handlers',
    async (role) => {
      const response = await request(app)
        .get('/api/claim/complaints')
        .set('x-test-role', role);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        success: false,
        error_code: 'CLAIM_USER_ROLE_REQUIRED',
        message: 'Endpoint hanya dapat diakses oleh user',
      });
      expect(handlers.getClaimComplaints).not.toHaveBeenCalled();
    }
  );

  test('keeps authenticated owner identity when another complaint is requested', async () => {
    const response = await request(app)
      .get('/api/claim/complaints/user-b-complaint?user_id=user-b')
      .set('x-test-user-id', 'user-a')
      .set('x-test-role', 'user');

    expect(response.status).toBe(204);
    expect(handlers.getClaimComplaints).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { complaintId: 'user-b-complaint' },
        user: { user_id: 'user-a', role: 'user' },
      }),
      expect.anything(),
      expect.anything()
    );
  });
});
