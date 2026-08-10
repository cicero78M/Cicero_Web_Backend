import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

describe('complaint dashboard response', () => {
  let app;
  let diagnoseComplaint;
  let findUserById;

  beforeEach(async () => {
    jest.resetModules();
    findUserById = jest.fn().mockResolvedValue({
      user_id: '75020201',
      nama: 'Nama Pelapor',
      client_id: 'DITBINMAS',
      whatsapp: '628123456789',
      email: 'pelapor@example.com',
    });
    diagnoseComplaint = jest.fn().mockResolvedValue({
      issue: 'Diagnosis aktivitas Instagram',
      solution: 'Muat ulang data aktivitas.',
    });

    jest.unstable_mockModule('../src/model/userModel.js', () => ({
      findUserById,
    }));
    jest.unstable_mockModule('../src/service/complaintService.js', () => ({
      normalizeComplaintHandle: jest.fn((value) => value || ''),
      parseComplaintMessage: jest.fn((raw) => ({ raw, issues: [raw] })),
    }));
    jest.unstable_mockModule(
      '../src/service/complaintDiagnosisService.js',
      () => ({ diagnoseComplaint })
    );

    const { postComplaintInstagram } = await import(
      '../src/controller/complaintController.js'
    );
    app = express();
    app.use(express.json());
    app.post(
      '/api/dashboard/komplain/insta',
      (req, _res, next) => {
        req.dashboardUser = {
          dashboard_user_id: 'dashboard-1',
          whatsapp: '628987654321',
        };
        next();
      },
      postComplaintInstagram
    );
  });

  test('builds diagnosis for dashboard without WhatsApp delivery state', async () => {
    const response = await request(app)
      .post('/api/dashboard/komplain/insta')
      .send({
        nrp: '75020201',
        issue: 'Like Instagram belum tercatat.',
      });

    expect(response.status).toBe(200);
    expect(findUserById).toHaveBeenCalledWith('75020201');
    expect(diagnoseComplaint).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '75020201',
        fallbackIssue: 'Like Instagram belum tercatat.',
      })
    );
    expect(response.body.data).toMatchObject({
      platform: 'Instagram',
      issue: 'Diagnosis aktivitas Instagram',
      solution: 'Muat ulang data aktivitas.',
      reporter: {
        nrp: '75020201',
        name: 'Nama Pelapor',
        whatsapp: '628123456789',
        email: 'pelapor@example.com',
      },
    });
    expect(response.body.data.message).toContain('Diagnosis aktivitas Instagram');
    expect(response.body.data).not.toHaveProperty('channel');
    expect(response.body.data).not.toHaveProperty('dashboard');
  });
});
