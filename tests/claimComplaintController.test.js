import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('claim complaint triage', () => {
  let app;
  let findClaimProfileById;
  let diagnoseComplaint;

  beforeEach(async () => {
    jest.resetModules();
    findClaimProfileById = jest.fn().mockResolvedValue({
      user_id: '12345',
      insta: 'registered.ig',
      tiktok: '@registered.tt',
    });
    diagnoseComplaint = jest.fn().mockResolvedValue({
      issue: 'Diagnosis aktivitas',
      solution: 'Lakukan verifikasi konten.',
      triageCode: 'ACTIVITY_DIAGNOSIS_AVAILABLE',
      triageQuality: 'complete',
      evidence: [{ type: 'registered_handle', available: true }],
      canEscalate: true,
    });

    await jest.isolateModulesAsync(async () => {
      jest.unstable_mockModule('../src/model/userModel.js', () => ({
        findClaimProfileById,
      }));
      jest.unstable_mockModule(
        '../src/service/complaintDiagnosisService.js',
        () => ({
          diagnoseComplaint,
        })
      );
      const { triageClaimComplaint } = await import(
        '../src/controller/claimComplaintController.js'
      );
      app = express();
      app.use(express.json());
      app.post(
        '/api/claim/complaints/triage',
        (req, _res, next) => {
          req.user = { user_id: req.get('x-test-user-id') };
          next();
        },
        triageClaimComplaint
      );
    });
  });

  test('uses only token user and returns the structured DTO', async () => {
    const response = await request(app)
      .post('/api/claim/complaints/triage')
      .set('x-test-user-id', '12345')
      .send({
        platform: 'instagram',
        issue_type: 'activity_not_recorded',
        content_id: 'ABC123',
        performed_at: '2026-08-09T10:30:00+07:00',
      });

    expect(response.status).toBe(200);
    expect(findClaimProfileById).toHaveBeenCalledWith('12345');
    expect(response.body.data).toMatchObject({
      complaint_id: null,
      platform: 'instagram',
      triage_code: 'ACTIVITY_DIAGNOSIS_AVAILABLE',
      triage_quality: 'complete',
      evidence: [{ type: 'registered_handle', available: true }],
      solutions: ['Lakukan verifikasi konten.'],
      can_escalate: true,
    });
  });

  test.each(['nrp', 'user_id', 'client_id', 'username'])(
    'rejects identity field %s before loading a user',
    async (field) => {
      const response = await request(app)
        .post('/api/claim/complaints/triage')
        .set('x-test-user-id', '12345')
        .send({
          platform: 'instagram',
          issue_type: 'activity_not_recorded',
          [field]: 'attacker-controlled',
        });

      expect(response.status).toBe(400);
      expect(response.body.error_code).toBe(
        'CLAIM_COMPLAINT_IDENTITY_FIELD_FORBIDDEN'
      );
      expect(findClaimProfileById).not.toHaveBeenCalled();
    }
  );

  test.each([
    ['platform', 'youtube', 'CLAIM_COMPLAINT_INVALID_PLATFORM'],
    ['issue_type', 'account_problem', 'CLAIM_COMPLAINT_INVALID_ISSUE_TYPE'],
  ])('rejects unsupported %s', async (field, value, errorCode) => {
    const payload = {
      platform: 'tiktok',
      issue_type: 'activity_not_recorded',
      [field]: value,
    };
    const response = await request(app)
      .post('/api/claim/complaints/triage')
      .set('x-test-user-id', '12345')
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error_code).toBe(errorCode);
  });
});
