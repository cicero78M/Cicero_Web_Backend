import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockWithTransaction = jest.fn();

jest.unstable_mockModule('../src/repository/db.js', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}));

const dashboardUserModel = await import('../src/model/dashboardUserModel.js');

beforeEach(() => {
  mockQuery.mockReset();
  mockWithTransaction.mockReset();
});

test('findPendingDashboardUsers queries only rows that are pending and not already active', async () => {
  mockQuery.mockResolvedValue({
    rows: [
      { username: 'pending_user', status: false, approval_status: 'pending' },
    ],
  });

  const rows = await dashboardUserModel.findPendingDashboardUsers(10);

  expect(rows).toEqual([
    { username: 'pending_user', status: false, approval_status: 'pending' },
  ]);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining("du.approval_status = 'pending'"),
    [10]
  );
  expect(mockQuery.mock.calls[0][0]).toContain('du.status IS NOT TRUE');
});

test('getEffectiveApprovalStatus treats legacy active dashboard users as approved', () => {
  expect(
    dashboardUserModel.getEffectiveApprovalStatus({
      username: 'legacy_user',
      status: true,
      approval_status: 'pending',
    })
  ).toBe('approved');
});

test('getEffectiveApprovalStatus keeps inactive pending users pending', () => {
  expect(
    dashboardUserModel.getEffectiveApprovalStatus({
      username: 'pending_user',
      status: false,
      approval_status: 'pending',
    })
  ).toBe('pending');
});

test('createUser writes pending approval_status for new dashboard registrations', async () => {
  mockQuery.mockResolvedValue({
    rows: [
      {
        dashboard_user_id: 'dash-1',
        status: false,
        approval_status: 'pending',
      },
    ],
  });

  await dashboardUserModel.createUser({
    dashboard_user_id: 'dash-1',
    username: 'new_user',
    password_hash: 'hash',
    role_id: 1,
    status: false,
    email: 'new@example.com',
  });

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('approval_status'),
    ['dash-1', 'new_user', 'hash', 1, false, 'pending', 'new@example.com']
  );
});

test('updateApprovalStatus approves only pending rows when requested', async () => {
  mockQuery.mockResolvedValue({
    rows: [
      {
        dashboard_user_id: 'dash-1',
        status: true,
        approval_status: 'approved',
      },
    ],
  });

  const updated = await dashboardUserModel.updateApprovalStatus(
    'dash-1',
    'approved',
    {
      onlyPending: true,
    }
  );

  expect(updated).toEqual({
    dashboard_user_id: 'dash-1',
    status: true,
    approval_status: 'approved',
  });
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining(
      "approval_status = 'pending' AND status IS NOT TRUE"
    ),
    ['dash-1', true, 'approved']
  );
});

test('updateApprovalStatus rejects with status false and rejected approval_status', async () => {
  mockQuery.mockResolvedValue({
    rows: [
      {
        dashboard_user_id: 'dash-1',
        status: false,
        approval_status: 'rejected',
      },
    ],
  });

  await dashboardUserModel.updateApprovalStatus('dash-1', 'rejected', {
    onlyPending: true,
  });

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('SET status=$2, approval_status=$3'),
    ['dash-1', false, 'rejected']
  );
});

test('findPendingDashboardUsers falls back to legacy status when approval_status column is missing', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockQuery
    .mockRejectedValueOnce({
      code: '42703',
      message: 'column "approval_status" does not exist',
    })
    .mockResolvedValueOnce({
      rows: [{ username: 'pending_user', status: false }],
    });

  const rows = await dashboardUserModel.findPendingDashboardUsers(10);

  expect(rows).toEqual([
    { username: 'pending_user', status: false, approval_status: 'pending' },
  ]);
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.not.stringContaining('approval_status'),
    [10]
  );
  warnSpy.mockRestore();
});

test('createUser falls back to legacy insert when approval_status column is missing', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockQuery
    .mockRejectedValueOnce({
      code: '42703',
      message: 'column "approval_status" does not exist',
    })
    .mockResolvedValueOnce({
      rows: [{ dashboard_user_id: 'dash-1', status: false }],
    });

  const user = await dashboardUserModel.createUser({
    dashboard_user_id: 'dash-1',
    username: 'new_user',
    password_hash: 'hash',
    role_id: 1,
    status: false,
    email: 'new@example.com',
  });

  expect(user).toEqual({
    dashboard_user_id: 'dash-1',
    status: false,
    approval_status: 'pending',
  });
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.not.stringContaining('approval_status'),
    ['dash-1', 'new_user', 'hash', 1, false, 'new@example.com']
  );
  warnSpy.mockRestore();
});

test('updateApprovalStatus falls back to legacy status update when approval_status column is missing', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockQuery
    .mockRejectedValueOnce({
      code: '42703',
      message: 'column "approval_status" does not exist',
    })
    .mockResolvedValueOnce({
      rows: [{ dashboard_user_id: 'dash-1', status: true }],
    });

  const updated = await dashboardUserModel.updateApprovalStatus(
    'dash-1',
    'approved',
    {
      onlyPending: true,
    }
  );

  expect(updated).toEqual({
    dashboard_user_id: 'dash-1',
    status: true,
    approval_status: 'approved',
  });
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining(
      'WHERE dashboard_user_id=$1 AND status IS NOT TRUE'
    ),
    ['dash-1', true]
  );
  expect(mockQuery.mock.calls[1][0]).not.toContain('approval_status');
  warnSpy.mockRestore();
});

test('findByUsername falls back without client_ids when dashboard_user_clients.client_id is missing', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockQuery
    .mockRejectedValueOnce({
      code: '42703',
      message: 'column duc.client_id does not exist',
    })
    .mockResolvedValueOnce({
      rows: [{ dashboard_user_id: 'dash-1', username: 'pending_user', client_ids: [] }],
    });

  const user = await dashboardUserModel.findByUsername('pending_user');

  expect(user).toEqual({
    dashboard_user_id: 'dash-1',
    username: 'pending_user',
    client_ids: [],
  });
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('ARRAY[]::VARCHAR[] AS client_ids'),
    ['pending_user']
  );
  expect(mockQuery.mock.calls[1][0]).not.toContain('dashboard_user_clients duc');
  warnSpy.mockRestore();
});

test('findPendingDashboardUsers falls back without client_ids when dashboard_user_clients.client_id is missing', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockQuery
    .mockRejectedValueOnce({
      code: '42703',
      message: 'column duc.client_id does not exist',
    })
    .mockResolvedValueOnce({
      rows: [{ username: 'pending_user', status: false, approval_status: 'pending', client_ids: [] }],
    });

  const rows = await dashboardUserModel.findPendingDashboardUsers(10);

  expect(rows).toEqual([
    { username: 'pending_user', status: false, approval_status: 'pending', client_ids: [] },
  ]);
  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining('ARRAY[]::VARCHAR[] AS client_ids'),
    [10]
  );
  expect(mockQuery.mock.calls[1][0]).toContain("du.approval_status = 'pending'");
  expect(mockQuery.mock.calls[1][0]).not.toContain('dashboard_user_clients duc');
  warnSpy.mockRestore();
});
