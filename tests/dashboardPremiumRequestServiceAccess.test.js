import { jest } from '@jest/globals';

const findLatestOpenByDashboardUserId = jest.fn();
const findLatestOpenByUsername = jest.fn();
const mockCreateSubscriptionWithClient = jest.fn();
const mockWithTransaction = jest.fn(async cb => cb({}));

jest.unstable_mockModule('../src/repository/db.js', () => ({
  withTransaction: mockWithTransaction,
  query: jest.fn(),
}));

jest.unstable_mockModule('../src/model/dashboardPremiumRequestModel.js', () => ({
  findLatestOpenByDashboardUserId,
  findLatestOpenByUsername,
}));

jest.unstable_mockModule('../src/model/dashboardUserModel.js', () => ({}));
jest.unstable_mockModule('../src/model/dashboardSubscriptionModel.js', () => ({}));
jest.unstable_mockModule('../src/service/dashboardSubscriptionService.js', () => ({
  createSubscriptionWithClient: mockCreateSubscriptionWithClient,
}));

const {
  findLatestOpenDashboardPremiumRequestByIdentifier,
} = await import('../src/service/dashboardPremiumRequestService.js');

describe('findLatestOpenDashboardPremiumRequestByIdentifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null for empty identifier', async () => {
    await expect(findLatestOpenDashboardPremiumRequestByIdentifier('')).resolves.toBeNull();
    expect(findLatestOpenByDashboardUserId).not.toHaveBeenCalled();
    expect(findLatestOpenByUsername).not.toHaveBeenCalled();
  });

  test('prefers dashboard_user_id when identifier is a UUID', async () => {
    const identifier = '123e4567-e89b-12d3-a456-426614174000';
    findLatestOpenByDashboardUserId.mockResolvedValueOnce({ request_id: 10, dashboard_user_id: identifier });

    const result = await findLatestOpenDashboardPremiumRequestByIdentifier(identifier);

    expect(result).toEqual({ request_id: 10, dashboard_user_id: identifier });
    expect(findLatestOpenByDashboardUserId).toHaveBeenCalledWith(identifier);
    expect(findLatestOpenByUsername).not.toHaveBeenCalled();
  });

  test('falls back to username lookup when UUID lookup misses', async () => {
    const identifier = '123e4567-e89b-12d3-a456-426614174000';
    findLatestOpenByDashboardUserId.mockResolvedValueOnce(null);
    findLatestOpenByUsername.mockResolvedValueOnce({ request_id: 11, username: identifier });

    const result = await findLatestOpenDashboardPremiumRequestByIdentifier(identifier);

    expect(result).toEqual({ request_id: 11, username: identifier });
    expect(findLatestOpenByDashboardUserId).toHaveBeenCalledWith(identifier);
    expect(findLatestOpenByUsername).toHaveBeenCalledWith(identifier);
  });

  test('skips dashboard_user_id lookup when identifier is not a UUID', async () => {
    findLatestOpenByUsername.mockResolvedValueOnce({ request_id: 12, username: 'not-uuid' });

    const result = await findLatestOpenDashboardPremiumRequestByIdentifier('not-uuid');

    expect(result).toEqual({ request_id: 12, username: 'not-uuid' });
    expect(findLatestOpenByDashboardUserId).not.toHaveBeenCalled();
    expect(findLatestOpenByUsername).toHaveBeenCalledWith('not-uuid');
  });
});
