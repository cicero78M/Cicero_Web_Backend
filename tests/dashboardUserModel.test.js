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

test('findPendingDashboardUsers queries textual pending approval status only', async () => {
  mockQuery.mockResolvedValue({ rows: [{ username: 'pending_user', approval_status: 'pending' }] });

  const rows = await dashboardUserModel.findPendingDashboardUsers(10);

  expect(rows).toEqual([{ username: 'pending_user', approval_status: 'pending' }]);
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining("du.approval_status = 'pending'"),
    [10],
  );
  expect(mockQuery.mock.calls[0][0]).not.toContain('du.status = false');
});

test('createUser writes pending approval_status for new dashboard registrations', async () => {
  mockQuery.mockResolvedValue({
    rows: [{ dashboard_user_id: 'dash-1', status: false, approval_status: 'pending' }],
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
    ['dash-1', 'new_user', 'hash', 1, false, 'pending', 'new@example.com'],
  );
});

test('updateApprovalStatus approves only pending rows when requested', async () => {
  mockQuery.mockResolvedValue({
    rows: [{ dashboard_user_id: 'dash-1', status: true, approval_status: 'approved' }],
  });

  const updated = await dashboardUserModel.updateApprovalStatus('dash-1', 'approved', {
    onlyPending: true,
  });

  expect(updated).toEqual({ dashboard_user_id: 'dash-1', status: true, approval_status: 'approved' });
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining("approval_status = 'pending'"),
    ['dash-1', true, 'approved'],
  );
});

test('updateApprovalStatus rejects with status false and rejected approval_status', async () => {
  mockQuery.mockResolvedValue({
    rows: [{ dashboard_user_id: 'dash-1', status: false, approval_status: 'rejected' }],
  });

  await dashboardUserModel.updateApprovalStatus('dash-1', 'rejected', { onlyPending: true });

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('SET status=$2, approval_status=$3'),
    ['dash-1', false, 'rejected'],
  );
});
