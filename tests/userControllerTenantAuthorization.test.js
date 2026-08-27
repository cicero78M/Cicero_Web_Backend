import { jest } from '@jest/globals';

const mockGetAllUsers = jest.fn();
const mockFindUserById = jest.fn();
const mockUpdateUser = jest.fn();

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getAllUsers: mockGetAllUsers,
  findUserById: mockFindUserById,
  updateUser: mockUpdateUser,
  findSocialUsernameConflict: jest.fn(),
  findSocialUsernameOwner: jest.fn(),
  replaceUserSocialAccounts: jest.fn(),
  updateUserField: jest.fn(),
  createUser: jest.fn(),
  deactivateRoleOrUser: jest.fn(),
}));

jest.unstable_mockModule('../src/service/userDirectoryService.js', () => ({
  getUserDirectoryUsers: jest.fn(),
  UserDirectoryError: class UserDirectoryError extends Error {},
}));

const userController = await import('../src/controller/userController.js');

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('legacy user CRUD tenant authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('operator listing is restricted to authenticated client_ids', async () => {
    mockGetAllUsers
      .mockResolvedValueOnce([{ user_id: 'u1', client_id: 'CLIENT_A' }])
      .mockResolvedValueOnce([
        { user_id: 'u1', client_id: 'CLIENT_A' },
        { user_id: 'u2', client_id: 'CLIENT_B' },
      ]);
    const req = {
      user: { role: 'operator', client_ids: ['CLIENT_A', 'CLIENT_B'] },
    };
    const res = createResponse();

    await userController.getAllUsers(req, res, jest.fn());

    expect(mockGetAllUsers).toHaveBeenNthCalledWith(1, 'CLIENT_A', 'operator');
    expect(mockGetAllUsers).toHaveBeenNthCalledWith(2, 'CLIENT_B', 'operator');
    expect(res.body.data).toHaveLength(2);
  });

  test('operator cannot read a user from another client', async () => {
    mockFindUserById.mockResolvedValue({ user_id: 'u2', client_id: 'CLIENT_B' });
    const req = {
      params: { id: 'u2' },
      user: { role: 'operator', client_ids: ['CLIENT_A'] },
    };
    const res = createResponse();

    await userController.getUserById(req, res, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: 'client_id tidak diizinkan',
    });
  });

  test('operator cannot update a user from another client', async () => {
    mockFindUserById.mockResolvedValue({ user_id: 'u2', client_id: 'CLIENT_B' });
    const req = {
      params: { id: 'u2' },
      body: { nama: 'Changed' },
      user: { role: 'operator', client_ids: ['CLIENT_A'] },
    };
    const res = createResponse();

    await userController.updateUser(req, res, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('operator cannot move an authorized user to another client', async () => {
    mockFindUserById.mockResolvedValue({ user_id: 'u1', client_id: 'CLIENT_A' });
    const req = {
      params: { id: 'u1' },
      body: { client_id: 'CLIENT_B' },
      user: { role: 'operator', client_ids: ['CLIENT_A'] },
    };
    const res = createResponse();

    await userController.updateUser(req, res, jest.fn());

    expect(res.statusCode).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
