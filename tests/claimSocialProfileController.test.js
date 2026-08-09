import { jest } from '@jest/globals';

process.env.JWT_SECRET = 'claim-social-profile-test-secret';
process.env.RAPIDAPI_KEY = 'test-key';

const fetchClaimSocialProfile = jest.fn();
const updateUser = jest.fn();
const replaceUserSocialAccounts = jest.fn();

jest.unstable_mockModule('../src/service/claimSocialProfileService.js', () => ({
  fetchClaimSocialProfile,
}));
jest.unstable_mockModule('../src/model/userModel.js', () => ({
  updateUser,
  replaceUserSocialAccounts,
}));
jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: {},
}));
jest.unstable_mockModule('../src/model/claimPasswordResetModel.js', () => ({}));
jest.unstable_mockModule('../src/service/emailService.js', () => ({
  sendClaimPasswordResetEmail: jest.fn(),
  sendOtpEmail: jest.fn(),
}));
jest.unstable_mockModule('../src/service/telegramService.js', () => ({
  sendTelegramAdminMessage: jest.fn(),
}));

const { validateClaimSocialProfile } = await import(
  '../src/controller/claimController.js'
);

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

async function validate(body) {
  const res = createResponse();
  await validateClaimSocialProfile({ body }, res, jest.fn());
  return res;
}

describe('validateClaimSocialProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['instagram', 'HTTPS://www.instagram.com/Cicero.Test/', 'cicero.test'],
    ['tiktok', 'https://www.tiktok.com/@Cicero.Test', '@cicero.test'],
  ])(
    'returns a stable DTO for a valid %s profile',
    async (platform, input, normalized) => {
      const dto = {
        platform,
        username: normalized,
        found: true,
        profile_name: 'Cicero',
        avatar_url: 'https://cdn.test/avatar.jpg',
        is_private: false,
        is_verified: false,
        followers: 10,
        following: 2,
        content_count: 3,
        data_quality: { score: 100, label: 'complete', components: [] },
      };
      fetchClaimSocialProfile.mockResolvedValueOnce(dto);

      const res = await validate({ platform, username: input });

      expect(fetchClaimSocialProfile).toHaveBeenCalledWith(
        platform,
        normalized
      );
      expect(res.json).toHaveBeenCalledWith({ success: true, data: dto });
    }
  );

  test('preserves the private profile indicator', async () => {
    fetchClaimSocialProfile.mockResolvedValueOnce({
      platform: 'instagram',
      username: 'private.user',
      found: true,
      is_private: true,
    });
    const res = await validate({
      platform: 'instagram',
      username: 'private.user',
    });
    expect(res.json.mock.calls[0][0].data.is_private).toBe(true);
  });

  test.each([
    [
      { platform: 'youtube', username: 'cicero' },
      'CLAIM_SOCIAL_PLATFORM_INVALID',
    ],
    [
      { platform: 'instagram', username: 'bad username!' },
      'CLAIM_SOCIAL_USERNAME_INVALID',
    ],
  ])(
    'rejects invalid input without calling RapidAPI',
    async (body, errorCode) => {
      const res = await validate(body);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].error_code).toBe(errorCode);
      expect(fetchClaimSocialProfile).not.toHaveBeenCalled();
    }
  );

  test.each([
    ['not_found', 404, 'CLAIM_SOCIAL_PROFILE_NOT_FOUND'],
    ['rate_limited', 429, 'CLAIM_SOCIAL_UPSTREAM_RATE_LIMITED'],
    [
      'configuration_unavailable',
      503,
      'CLAIM_SOCIAL_CONFIGURATION_UNAVAILABLE',
    ],
    ['upstream_unavailable', 502, 'CLAIM_SOCIAL_UPSTREAM_UNAVAILABLE'],
  ])(
    'maps %s without exposing upstream details',
    async (code, status, errorCode) => {
      const error = new Error('sensitive upstream payload');
      error.code = code;
      fetchClaimSocialProfile.mockRejectedValueOnce(error);
      const res = await validate({ platform: 'instagram', username: 'cicero' });
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json.mock.calls[0][0].error_code).toBe(errorCode);
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(
        'sensitive'
      );
    }
  );

  test('never performs a database update', async () => {
    fetchClaimSocialProfile.mockResolvedValueOnce({ found: true });
    await validate({ platform: 'instagram', username: 'cicero' });
    expect(updateUser).not.toHaveBeenCalled();
    expect(replaceUserSocialAccounts).not.toHaveBeenCalled();
  });
});
