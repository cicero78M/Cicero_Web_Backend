import { jest } from '@jest/globals';

const activeStatuses = [
  'triaged',
  'waiting_sync',
  'needs_user_action',
  'escalated',
];

const initialStatusCases = [
  ['ACTIVITY_ALREADY_RECORDED', 'triaged'],
  ['SOCIAL_USERNAME_MISSING', 'needs_user_action'],
  ['SOCIAL_USERNAME_MISMATCH', 'needs_user_action'],
  ['SOCIAL_PROFILE_PRIVATE', 'needs_user_action'],
  ['SOCIAL_PROFILE_NOT_FOUND', 'needs_user_action'],
  ['SOCIAL_PROFILE_SUSPICIOUS', 'triaged'],
  ['ENGAGEMENT_NOT_IN_SNAPSHOT', 'triaged'],
  ['DATA_COLLECTION_STALE', 'waiting_sync'],
  ['UPSTREAM_UNAVAILABLE', 'waiting_sync'],
  ['MANUAL_REVIEW_REQUIRED', 'triaged'],
];

describe('claim complaint lifecycle service', () => {
  let model;
  let lifecycle;

  beforeEach(async () => {
    jest.resetModules();
    model = {
      createComplaint: jest.fn(),
      findComplaintById: jest.fn(),
      transitionComplaintStatus: jest.fn(),
    };
    jest.unstable_mockModule(
      '../src/model/claimComplaintModel.js',
      () => model
    );
    lifecycle = await import(
      '../src/service/claimComplaintLifecycleService.js'
    );
  });

  test.each(initialStatusCases)(
    'maps %s to initial status %s',
    (triageCode, expectedStatus) => {
      expect(lifecycle.getInitialClaimComplaintStatus(triageCode)).toBe(
        expectedStatus
      );
    }
  );

  test.each(
    initialStatusCases.filter(([code]) => code !== 'ACTIVITY_ALREADY_RECORDED')
  )(
    'passes initial status for %s to persistence',
    async (triageCode, expectedStatus) => {
      model.createComplaint.mockResolvedValue({ created: true });

      await lifecycle.createOrGetActiveClaimComplaint({
        userId: 'user-1',
        clientId: 'client-1',
        platform: 'instagram',
        contentId: 'content-1',
        issueType: 'activity_not_recorded',
        triageSnapshot: { triage_code: triageCode },
      });

      expect(model.createComplaint).toHaveBeenCalledWith(
        expect.objectContaining({ status: expectedStatus })
      );
    }
  );

  test('rejects a triage code outside the domain mapping', () => {
    expect(() => lifecycle.getInitialClaimComplaintStatus('UNKNOWN')).toThrow(
      expect.objectContaining({ code: 'CLAIM_COMPLAINT_TRIAGE_INVALID' })
    );
  });

  test.each(
    activeStatuses.flatMap((fromStatus) =>
      activeStatuses
        .filter((toStatus) => toStatus !== fromStatus)
        .concat('resolved')
        .map((toStatus) => [fromStatus, toStatus])
    )
  )('permits internal transition %s -> %s', async (fromStatus, toStatus) => {
    const transitioned = {
      complaint_id: 'complaint-1',
      status: toStatus,
    };
    model.findComplaintById.mockResolvedValue({
      complaint_id: 'complaint-1',
      status: fromStatus,
    });
    model.transitionComplaintStatus.mockResolvedValue(transitioned);

    await expect(
      lifecycle.transitionClaimComplaint({
        complaintId: 'complaint-1',
        userId: 'user-1',
        expectedStatus: fromStatus,
        nextStatus: toStatus,
      })
    ).resolves.toBe(transitioned);
    expect(model.transitionComplaintStatus).toHaveBeenCalledWith({
      complaintId: 'complaint-1',
      userId: 'user-1',
      expectedStatus: fromStatus,
      nextStatus: toStatus,
    });
  });

  test.each(activeStatuses)(
    'rejects illegal no-op transition from %s',
    async (status) => {
      await expect(
        lifecycle.transitionClaimComplaint({
          complaintId: 'complaint-1',
          userId: 'user-1',
          expectedStatus: status,
          nextStatus: status,
        })
      ).rejects.toMatchObject({ code: 'CLAIM_COMPLAINT_TRANSITION_INVALID' });
      expect(model.findComplaintById).not.toHaveBeenCalled();
    }
  );

  test.each(activeStatuses)(
    'rejects resolved -> %s without an explicit reopen workflow',
    async (nextStatus) => {
      await expect(
        lifecycle.transitionClaimComplaint({
          complaintId: 'complaint-1',
          userId: 'user-1',
          expectedStatus: 'resolved',
          nextStatus,
        })
      ).rejects.toMatchObject({ code: 'CLAIM_COMPLAINT_TRANSITION_INVALID' });
    }
  );

  test.each(['triaged', 'waiting_sync', 'needs_user_action'])(
    'does not expose user transition to operational status %s',
    async (nextStatus) => {
      const expectedStatus =
        nextStatus === 'triaged' ? 'waiting_sync' : 'triaged';
      await expect(
        lifecycle.transitionClaimComplaint({
          complaintId: 'complaint-1',
          userId: 'user-1',
          expectedStatus,
          nextStatus,
          actor: 'user',
        })
      ).rejects.toMatchObject({ code: 'CLAIM_COMPLAINT_TRANSITION_FORBIDDEN' });
    }
  );

  test('reports a stale concurrent compare-and-set update', async () => {
    model.findComplaintById.mockResolvedValue({
      complaint_id: 'complaint-1',
      status: 'waiting_sync',
    });
    model.transitionComplaintStatus.mockResolvedValue(null);

    await expect(
      lifecycle.transitionClaimComplaint({
        complaintId: 'complaint-1',
        userId: 'user-1',
        expectedStatus: 'triaged',
        nextStatus: 'resolved',
        actor: 'user',
      })
    ).rejects.toMatchObject({ code: 'CLAIM_COMPLAINT_STATUS_CONFLICT' });
  });

  test('does not update a complaint owned by another user', async () => {
    model.findComplaintById.mockResolvedValue(null);

    await expect(
      lifecycle.transitionClaimComplaint({
        complaintId: 'user-2-complaint',
        userId: 'user-1',
        expectedStatus: 'triaged',
        nextStatus: 'escalated',
        actor: 'user',
      })
    ).rejects.toMatchObject({ code: 'CLAIM_COMPLAINT_NOT_FOUND' });
    expect(model.findComplaintById).toHaveBeenCalledWith(
      'user-2-complaint',
      'user-1'
    );
    expect(model.transitionComplaintStatus).not.toHaveBeenCalled();
  });
});
