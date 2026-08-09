import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

describe('claim complaint triage', () => {
  let app;
  let findClaimProfileById;
  let diagnoseComplaint;
  let getComplaintContentForUser;
  let hasUserLikedShortcode;
  let hasUserCommentedVideo;

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
    getComplaintContentForUser = jest.fn().mockResolvedValue({
      item: { shortcode: 'ABC123' },
      usernames: ['registered.ig'],
    });
    hasUserLikedShortcode = jest.fn().mockResolvedValue({
      hasActivity: false,
      updatedAt: '2026-08-09T03:00:00.000Z',
      latestAudit: { capturedAt: '2026-08-09T03:05:00.000Z' },
    });
    hasUserCommentedVideo = jest.fn().mockResolvedValue({
      hasActivity: false,
      updatedAt: null,
      latestAudit: null,
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
      jest.unstable_mockModule(
        '../src/service/claimPendingContentService.js',
        () => ({ getComplaintContentForUser })
      );
      jest.unstable_mockModule('../src/model/instaLikeModel.js', () => ({
        hasUserLikedShortcode,
      }));
      jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
        hasUserCommentedVideo,
      }));
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
        shortcode: 'ABC123',
        performed_at: '2026-08-09T10:30:00+07:00',
      });

    expect(response.status).toBe(200);
    expect(findClaimProfileById).toHaveBeenCalledWith('12345');
    expect(getComplaintContentForUser).toHaveBeenCalledWith(
      '12345',
      'instagram',
      'ABC123',
      expect.objectContaining({ periode: 'harian' })
    );
    expect(hasUserLikedShortcode).toHaveBeenCalledWith(
      'registered.ig',
      'ABC123'
    );
    expect(diagnoseComplaint).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: '12345',
        claimPlatform: 'instagram',
        fallbackIssue: expect.stringContaining('Instagram'),
      })
    );
    expect(response.body.data).toMatchObject({
      complaint_id: null,
      platform: 'instagram',
      triage_code: 'ACTIVITY_DIAGNOSIS_AVAILABLE',
      triage_quality: 'complete',
      evidence: [{ type: 'registered_handle', available: true }],
      solutions: ['Lakukan verifikasi konten.'],
      can_escalate: true,
      last_collected_at: '2026-08-09T03:05:00.000Z',
      performed_at: '2026-08-09T10:30:00+07:00',
      next_action: 'FOLLOW_TRIAGE_GUIDANCE',
    });
  });

  test.each([
    'nrp',
    'user_id',
    'client_id',
    'username',
    'insta',
    'tiktok',
    'instagram_username',
    'tiktok_username',
  ])(
    'rejects identity field %s before loading a user',
    async (field) => {
      const response = await request(app)
        .post('/api/claim/complaints/triage')
        .set('x-test-user-id', '12345')
        .send({
          platform: 'instagram',
          issue_type: 'activity_not_recorded',
          shortcode: 'ABC123',
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
      video_id: 'video-1',
      [field]: value,
    };
    const response = await request(app)
      .post('/api/claim/complaints/triage')
      .set('x-test-user-id', '12345')
      .send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error_code).toBe(errorCode);
  });

  test.each(['description', 'complaint', 'issue', 'solution', 'solutions'])(
    'rejects client-authored triage field %s',
    async (field) => {
      const response = await request(app)
        .post('/api/claim/complaints/triage')
        .set('x-test-user-id', '12345')
        .send({
          platform: 'instagram',
          issue_type: 'activity_not_recorded',
          shortcode: 'ABC123',
          [field]: 'Keputusan atau solusi buatan client',
        });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error_code: 'CLAIM_COMPLAINT_UNSUPPORTED_FIELD',
        field,
      });
      expect(findClaimProfileById).not.toHaveBeenCalled();
      expect(diagnoseComplaint).not.toHaveBeenCalled();
    }
  );

  test('requires the platform-specific identifier', async () => {
    const response = await request(app)
      .post('/api/claim/complaints/triage')
      .set('x-test-user-id', '12345')
      .send({ platform: 'instagram', issue_type: 'activity_not_recorded' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error_code: 'CLAIM_COMPLAINT_CONTENT_ID_REQUIRED',
      field: 'shortcode',
    });
  });

  test('rejects an identifier outside the pending-content scope', async () => {
    getComplaintContentForUser.mockResolvedValue(false);
    const response = await request(app)
      .post('/api/claim/complaints/triage')
      .set('x-test-user-id', '12345')
      .send({
        platform: 'tiktok',
        issue_type: 'activity_not_recorded',
        video_id: 'outside',
      });

    expect(response.status).toBe(403);
    expect(response.body.error_code).toBe(
      'CLAIM_COMPLAINT_CONTENT_OUT_OF_SCOPE'
    );
    expect(diagnoseComplaint).not.toHaveBeenCalled();
  });
});
