import { jest } from '@jest/globals';

const mockCreateUser = jest.fn();
const mockFindUserById = jest.fn();
const mockUpdateUserField = jest.fn();
const mockUpdateUser = jest.fn();
const mockGetUsersByClient = jest.fn();
const mockGetUsersByClientAndRole = jest.fn();
const mockGetUsersByDirektorat = jest.fn();
const mockFindClientById = jest.fn();
const mockUpdateUserRolesUserId = jest.fn();
const mockGetUserDirectoryUsers = jest.fn();
const mockFindSocialUsernameConflict = jest.fn();
const mockFindSocialUsernameOwner = jest.fn();
const mockReplaceUserSocialAccounts = jest.fn();

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  createUser: mockCreateUser,
  findUserById: mockFindUserById,
  updateUserField: mockUpdateUserField,
  updateUser: mockUpdateUser,
  getUsersByClient: mockGetUsersByClient,
  getUsersByClientAndRole: mockGetUsersByClientAndRole,
  getUsersByDirektorat: mockGetUsersByDirektorat,
  updateUserRolesUserId: mockUpdateUserRolesUserId,
  findSocialUsernameConflict: mockFindSocialUsernameConflict,
  findSocialUsernameOwner: mockFindSocialUsernameOwner,
  replaceUserSocialAccounts: mockReplaceUserSocialAccounts,
}));

jest.unstable_mockModule('../src/service/clientService.js', () => ({
  findClientById: mockFindClientById,
}));

jest.unstable_mockModule('../src/service/userDirectoryService.js', () => ({
  getUserDirectoryUsers: mockGetUserDirectoryUsers,
  UserDirectoryError: class UserDirectoryError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  },
}));

let createUser;
let getUserList;
let getUsersByClientCtrl;
let updateUserRolesCtrl;
let updateUserRoleIdsCtrl;
let updateUserCtrl;

beforeAll(async () => {
  const mod = await import('../src/controller/userController.js');
  createUser = mod.createUser;
  getUserList = mod.getUserList;
  getUsersByClientCtrl = mod.getUsersByClient;
  updateUserRolesCtrl = mod.updateUserRoles;
  updateUserRoleIdsCtrl = mod.updateUserRoleIds;
  updateUserCtrl = mod.updateUser;
});

beforeEach(() => {
  mockCreateUser.mockReset();
  mockFindUserById.mockReset();
  mockUpdateUserField.mockReset();
  mockUpdateUser.mockReset();
  mockGetUsersByClient.mockReset();
  mockGetUsersByClientAndRole.mockReset();
  mockGetUsersByDirektorat.mockReset();
  mockFindClientById.mockReset();
  mockUpdateUserRolesUserId.mockReset();
  mockGetUserDirectoryUsers.mockReset();
  mockFindSocialUsernameConflict.mockReset().mockResolvedValue(null);
  mockFindSocialUsernameOwner.mockReset().mockResolvedValue(null);
  mockReplaceUserSocialAccounts.mockReset().mockResolvedValue(undefined);
});

function createResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { status, json }, status, json };
}

test.each([
  [
    'insta',
    'https://instagram.com/Already.Taken',
    'instagram',
    'already.taken',
  ],
  ['tiktok', 'https://tiktok.com/@Already.Taken', 'tiktok', '@already.taken'],
])(
  'create rejects duplicate %s owner before saving',
  async (field, value, platform, normalized) => {
    mockFindUserById.mockResolvedValue(null);
    mockFindSocialUsernameOwner.mockImplementation(async (checkedPlatform) =>
      checkedPlatform === platform
        ? { platform, username: normalized, user_id: 'other-user' }
        : null
    );
    const req = {
      body: { user_id: 'new-user', nama: 'New User', [field]: value },
      user: { role: 'operator' },
    };
    const { res, status, json } = createResponse();

    await createUser(req, res, jest.fn());

    expect(mockFindSocialUsernameOwner).toHaveBeenCalledWith(platform, [
      normalized,
    ]);
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockReplaceUserSocialAccounts).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error_code: 'SOCIAL_USERNAME_CONFLICT',
        field: platform,
      })
    );
  }
);

test('create allows the same username on a different platform and synchronizes primaries', async () => {
  mockFindUserById.mockResolvedValue(null);
  mockCreateUser.mockResolvedValue({ user_id: 'new-user' });
  const req = {
    body: {
      user_id: 'new-user',
      nama: 'New User',
      insta: '@shared',
      tiktok: '@shared',
    },
    user: { role: 'operator' },
  };
  const { res } = createResponse();

  await createUser(req, res, jest.fn());

  expect(mockFindSocialUsernameOwner).toHaveBeenNthCalledWith(1, 'instagram', [
    'shared',
  ]);
  expect(mockFindSocialUsernameOwner).toHaveBeenNthCalledWith(2, 'tiktok', [
    '@shared',
  ]);
  expect(mockCreateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      insta: 'shared',
      tiktok: '@shared',
    })
  );
  expect(mockReplaceUserSocialAccounts).toHaveBeenCalledWith(
    'new-user',
    'instagram',
    ['shared']
  );
  expect(mockReplaceUserSocialAccounts).toHaveBeenCalledWith(
    'new-user',
    'tiktok',
    ['@shared']
  );
});

test.each([
  ['insta', '@taken', 'instagram', 'taken'],
  ['tiktok', '@taken', 'tiktok', '@taken'],
])(
  'update rejects duplicate %s without saving other fields',
  async (field, value, platform, normalized) => {
    mockFindSocialUsernameConflict.mockResolvedValue({
      platform,
      username: normalized,
      user_id: 'other-user',
    });
    const req = {
      params: { id: 'current-user' },
      body: { nama: 'Changed', [field]: value },
    };
    const { res, status } = createResponse();

    await updateUserCtrl(req, res, jest.fn());

    expect(mockFindSocialUsernameConflict).toHaveBeenCalledWith(
      'current-user',
      platform,
      [normalized]
    );
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockReplaceUserSocialAccounts).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
  }
);

test('operator adds user with defaults', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '1' });
  const req = {
    body: { user_id: '1', nama: 'A' },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '1',
    nama: 'A',
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true,
  });
  expect(status).toHaveBeenCalledWith(201);
  expect(json).toHaveBeenCalledWith({ success: true, data: { user_id: '1' } });
});

test('operator assigns ditbinmas role when specified', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '3' });
  const req = {
    body: { user_id: '3', nama: 'C', roles: ['ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '3',
    nama: 'C',
    ditbinmas: true,
  });
  expect(mockCreateUser.mock.calls[0][0].operator).toBeUndefined();
  expect(status).toHaveBeenCalledWith(201);
  expect(json).toHaveBeenCalledWith({ success: true, data: { user_id: '3' } });
});

test('operator assigns multiple roles simultaneously', async () => {
  mockCreateUser.mockResolvedValue({ user_id: '4' });
  const req = {
    body: { user_id: '4', nama: 'D', roles: ['operator', 'ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith({
    user_id: '4',
    nama: 'D',
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
  expect(status).toHaveBeenCalledWith(201);
});

test('operator reactivates existing user and attaches operator role', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '1', status: false })
    .mockResolvedValueOnce({
      user_id: '1',
      status: true,
      operator: true,
      nama: 'A',
    });
  const req = {
    body: { user_id: '1', nama: 'A' },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockFindUserById).toHaveBeenCalledWith('1');
  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    status: true,
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true,
  });
  expect(mockUpdateUserField).not.toHaveBeenCalled();
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '1', status: true, operator: true, nama: 'A' },
  });
});

test('operator reactivates existing user with multiple roles', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '5', status: false })
    .mockResolvedValueOnce({
      user_id: '5',
      status: true,
      operator: true,
      ditbinmas: true,
      nama: 'E',
    });
  const req = {
    body: { user_id: '5', nama: 'E', roles: ['operator', 'ditbinmas'] },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockFindUserById).toHaveBeenCalledWith('5');
  expect(mockUpdateUser).toHaveBeenCalledWith('5', {
    status: true,
    ditbinmas: false,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: true,
  });
  expect(mockUpdateUserField).not.toHaveBeenCalled();
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: {
      user_id: '5',
      status: true,
      operator: true,
      ditbinmas: true,
      nama: 'E',
    },
  });
});

test('updateUserRoles updates roles based on array', async () => {
  mockUpdateUser.mockResolvedValue({
    user_id: '1',
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
  const req = {
    params: { id: '1' },
    body: { roles: ['operator', 'ditbinmas'] },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await updateUserRolesCtrl(req, res, () => {});

  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    operator: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
  });
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      success: true,
      data: {
        user_id: '1',
        operator: true,
        ditbinmas: true,
        ditlantas: false,
        bidhumas: false,
        ditsamapta: false,
        ditintelkam: false,
      },
    });
  });

test('updateUserRoleIds updates user_roles mapping', async () => {
  const req = { body: { old_user_id: '1', new_user_id: '2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await updateUserRoleIdsCtrl(req, res, () => {});

  expect(mockUpdateUserRolesUserId).toHaveBeenCalledWith('1', '2');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { old_user_id: '1', new_user_id: '2' },
  });
});

test('reactivates existing user and attaches ditbinmas role', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '1', status: false })
    .mockResolvedValueOnce({
      user_id: '1',
      status: true,
      ditbinmas: true,
      nama: 'B',
      operator: false,
    });
  const req = {
    body: { user_id: '1', nama: 'B' },
    user: { role: 'ditbinmas', client_id: 'c2' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockUpdateUser).toHaveBeenCalledWith('1', {
    status: true,
    ditbinmas: true,
    ditlantas: false,
    bidhumas: false,
    ditsamapta: false,
    ditintelkam: false,
    operator: false,
  });
  expect(mockUpdateUserField).toHaveBeenCalledWith('1', 'client_id', 'C2');
  expect(mockCreateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: {
      user_id: '1',
      status: true,
      ditbinmas: true,
      nama: 'B',
      operator: false,
    },
  });
});

test('keeps existing roles when adding new role to active user', async () => {
  mockFindUserById
    .mockResolvedValueOnce({ user_id: '9', status: true, operator: true })
    .mockResolvedValueOnce({
      user_id: '9',
      status: true,
      operator: true,
      ditlantas: true,
    });
  const req = {
    body: { user_id: '9', nama: 'F', roles: ['ditlantas'] },
    user: { role: 'operator', client_id: 'c1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockUpdateUserField).toHaveBeenCalledWith('9', 'ditlantas', true);
  expect(mockUpdateUser).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: { user_id: '9', status: true, operator: true, ditlantas: true },
  });
});

test('ditlantas creates new user with flag', async () => {
  mockFindUserById.mockResolvedValue(null);
  mockCreateUser.mockResolvedValue({
    user_id: '2',
    ditlantas: true,
    client_id: 'c2',
  });
  const req = {
    body: { user_id: '2', nama: 'B' },
    user: { role: 'ditlantas', client_id: 'c2' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: '2',
      nama: 'B',
      client_id: 'c2',
      ditlantas: true,
    })
  );
  expect(status).toHaveBeenCalledWith(201);
});

test('ditintelkam creates new user with flag', async () => {
  mockFindUserById.mockResolvedValue(null);
  mockCreateUser.mockResolvedValue({
    user_id: '10',
    ditintelkam: true,
    client_id: 'DITINTELKAM',
  });
  const req = {
    body: { user_id: '10', nama: 'Test User' },
    user: { role: 'ditintelkam', client_id: 'DITINTELKAM' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await createUser(req, res, () => {});

  expect(mockCreateUser).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: '10',
      nama: 'Test User',
      client_id: 'DITINTELKAM',
      ditintelkam: true,
    })
  );
  expect(status).toHaveBeenCalledWith(201);
});

test('ditbinmas role with matching client_id shows all users', async () => {
  mockGetUserDirectoryUsers.mockResolvedValue({
    users: [{ user_id: '1', ditbinmas: true }],
  });
  const req = {
    user: { role: 'ditbinmas', client_id: 'DITBINMAS' },
    query: { client_id: 'ditbinmas' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockGetUserDirectoryUsers).toHaveBeenCalledWith({
    requesterRole: 'ditbinmas',
    tokenClientId: 'DITBINMAS',
    tokenClientIds: ['DITBINMAS'],
    clientId: 'ditbinmas',
    role: 'ditbinmas',
    scope: 'org',
    regionalId: null,
  });
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: [{ user_id: '1', ditbinmas: true }],
  });
});

test('ditbinmas role with different client_id filters users by client', async () => {
  mockGetUserDirectoryUsers.mockResolvedValue({
    users: [{ user_id: '2', ditbinmas: true }],
  });
  const req = {
    user: { role: 'ditbinmas', client_id: 'c1' },
    query: { client_id: 'ditbinmas' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockGetUserDirectoryUsers).toHaveBeenCalledWith({
    requesterRole: 'ditbinmas',
    tokenClientId: 'c1',
    tokenClientIds: ['c1'],
    clientId: 'ditbinmas',
    role: 'ditbinmas',
    scope: 'org',
    regionalId: null,
  });
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: [{ user_id: '2', ditbinmas: true }],
  });
});

test('ditsamapta client routes to direktorate handler with token client filter', async () => {
  mockGetUserDirectoryUsers.mockResolvedValue({
    users: [{ user_id: '4', ditsamapta: true }],
  });
  const req = {
    user: { role: 'admin', client_id: 'ORG1' },
    query: { client_id: 'DITSAMAPTA' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockGetUserDirectoryUsers).toHaveBeenCalledWith({
    requesterRole: 'admin',
    tokenClientId: 'ORG1',
    tokenClientIds: ['ORG1'],
    clientId: 'DITSAMAPTA',
    role: 'admin',
    scope: 'org',
    regionalId: null,
  });
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: [{ user_id: '4', ditsamapta: true }],
  });
});

test('non-operator role with org client uses client id and role', async () => {
  mockGetUserDirectoryUsers.mockResolvedValue({ users: [{ user_id: '3' }] });
  const req = { user: { role: 'admin' }, query: { client_id: 'c2' } };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUserList(req, res, () => {});

  expect(mockGetUserDirectoryUsers).toHaveBeenCalledWith({
    requesterRole: 'admin',
    tokenClientId: undefined,
    tokenClientIds: [],
    clientId: 'c2',
    role: 'admin',
    scope: 'org',
    regionalId: null,
  });
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: [{ user_id: '3' }],
  });
});

test('getUsersByClient uses token client and role for ditbinmas', async () => {
  mockGetUsersByClient.mockResolvedValue([{ user_id: '1' }]);
  const req = {
    params: { client_id: 'other' },
    user: { role: 'ditbinmas', client_id: 'C1' },
  };
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { status, json };

  await getUsersByClientCtrl(req, res, () => {});

  expect(mockGetUsersByClient).toHaveBeenCalledWith('C1', 'ditbinmas');
  expect(status).toHaveBeenCalledWith(200);
  expect(json).toHaveBeenCalledWith({
    success: true,
    data: [{ user_id: '1' }],
  });
});
