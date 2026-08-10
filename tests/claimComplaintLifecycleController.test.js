import { jest } from '@jest/globals';

describe('claim complaint lifecycle authorization', () => {
  let handlers;
  let model;
  let deliverClaimComplaintNotification;

  beforeEach(async () => {
    jest.resetModules();
    model = {
      findComplaintsByUserId: jest.fn().mockResolvedValue([]),
      findComplaintLifecycleById: jest.fn().mockResolvedValue(null),
      findComplaintById: jest.fn().mockResolvedValue(null),
      transitionComplaintStatus: jest.fn(),
      findNotification: jest.fn(),
    };
    deliverClaimComplaintNotification = jest.fn();
    jest.unstable_mockModule(
      '../src/model/claimComplaintModel.js',
      () => model
    );
    jest.unstable_mockModule(
      '../src/service/claimComplaintNotificationService.js',
      () => ({ deliverClaimComplaintNotification })
    );
    handlers = await import(
      '../src/controller/claimComplaintLifecycleController.js'
    );
  });

  function createResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  test.each([
    ['read status', 'getClaimComplaints'],
    ['escalate', 'escalateClaimComplaint'],
    ['resolve', 'resolveClaimComplaint'],
    ['retry notification', 'retryClaimComplaintNotification'],
  ])('user A cannot %s for user B complaint', async (_label, handlerName) => {
    const req = {
      user: { user_id: '1001' },
      params: { complaintId: 'user-b-complaint', user_id: 'user-b' },
      query: { user_id: 'user-b', nrp: 'user-b' },
      body: {
        user_id: 'user-b',
        nrp: 'user-b',
        expected_status: 'triaged',
      },
    };
    const res = createResponse();
    const next = jest.fn();

    await handlers[handlerName](req, res, next);

    const lookup =
      handlerName === 'getClaimComplaints'
        ? model.findComplaintLifecycleById
        : model.findComplaintById;
    expect(lookup).toHaveBeenCalledWith('user-b-complaint', '1001');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error_code: 'CLAIM_COMPLAINT_NOT_FOUND',
    });
    expect(model.transitionComplaintStatus).not.toHaveBeenCalled();
    expect(deliverClaimComplaintNotification).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('lists only authenticated user complaints using a safe DTO allowlist', async () => {
    model.findComplaintsByUserId.mockResolvedValueOnce([
      {
        complaint_id: 'complaint-a',
        platform: 'instagram',
        content_id: 'shortcode-1',
        issue_type: 'activity_not_recorded',
        status: 'triaged',
        triage_code: 'WAIT_FOR_SYNC',
        triage_quality: 'high',
        triage_evidence: {
          activity_recorded: false,
          snapshot_available: true,
          last_collected_at: '2026-08-10T00:00:00.000Z',
          performed_at: null,
          internal_trace: 'must-not-leak',
        },
        created_at: '2026-08-10T00:00:00.000Z',
        updated_at: '2026-08-10T00:01:00.000Z',
        escalated_at: null,
        resolved_at: null,
        notification: { last_error: 'secret delivery error' },
        triage_payload: { internal_prompt: 'must-not-leak' },
      },
    ]);
    const req = {
      user: { user_id: '1001' },
      params: {},
      query: { user_id: 'user-b' },
      body: { nrp: 'user-b' },
    };
    const res = createResponse();

    await handlers.getClaimComplaints(req, res, jest.fn());

    expect(model.findComplaintsByUserId).toHaveBeenCalledWith('1001');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        {
          complaint_id: 'complaint-a',
          platform: 'instagram',
          content_id: 'shortcode-1',
          issue_type: 'activity_not_recorded',
          status: 'triaged',
          triage: {
            code: 'WAIT_FOR_SYNC',
            quality: 'high',
            evidence: {
              activity_recorded: false,
              snapshot_available: true,
              last_collected_at: '2026-08-10T00:00:00.000Z',
              performed_at: null,
            },
          },
          created_at: '2026-08-10T00:00:00.000Z',
          updated_at: '2026-08-10T00:01:00.000Z',
          escalated_at: null,
          resolved_at: null,
        },
      ],
    });
  });
});
