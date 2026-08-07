import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'pending-content-test-secret';

const getPendingContentForUser = jest.fn();

jest.unstable_mockModule('../src/service/claimPendingContentService.js', () => ({
  getPendingContentForUser,
}));

const { getPendingContent } = await import('../src/controller/claimController.js');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('getPendingContent controller', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects a token without a user identity', async () => {
    const res = createResponse();
    await getPendingContent({ user: { role: 'user' }, query: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(getPendingContentForUser).not.toHaveBeenCalled();
  });

  test('rejects a token whose role is not user', async () => {
    const res = createResponse();
    await getPendingContent(
      { user: { user_id: 'other-user', role: 'operator' }, query: {} },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(getPendingContentForUser).not.toHaveBeenCalled();
  });

  test('returns not found when the authenticated user does not exist', async () => {
    getPendingContentForUser.mockResolvedValue(null);
    const res = createResponse();
    await getPendingContent(
      { user: { user_id: 'missing', role: 'user' }, query: {} },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('validates date filters with the shared date utility contract', async () => {
    const res = createResponse();
    await getPendingContent(
      {
        user: { user_id: '1', role: 'user' },
        query: { start_date: '2026-08-01' },
      },
      res,
      jest.fn()
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getPendingContentForUser).not.toHaveBeenCalled();
  });

  test('uses only user_id from the token and defaults to the Jakarta daily filter', async () => {
    getPendingContentForUser.mockResolvedValue({ user_id: 'token-user' });
    const res = createResponse();
    await getPendingContent(
      {
        user: { user_id: 'token-user', role: 'USER' },
        query: { user_id: 'attacker', nrp: 'attacker' },
      },
      res,
      jest.fn()
    );
    expect(getPendingContentForUser).toHaveBeenCalledWith('token-user', {
      periode: 'harian',
      tanggal: undefined,
      startDate: undefined,
      endDate: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { user_id: 'token-user' },
    });
  });
});
