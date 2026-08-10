import { jest } from '@jest/globals';

describe('claim complaint lifecycle persistence', () => {
  test('uses owner and expected status in one atomic update', async () => {
    jest.resetModules();
    const query = jest.fn().mockResolvedValue({
      rows: [{ complaint_id: 'complaint-1', status: 'resolved' }],
    });
    jest.unstable_mockModule('../src/repository/db.js', () => ({
      query,
      withTransaction: jest.fn(),
    }));
    const { transitionComplaintStatus } = await import(
      '../src/model/claimComplaintModel.js'
    );

    await transitionComplaintStatus({
      complaintId: 'complaint-1',
      userId: 'user-1',
      expectedStatus: 'escalated',
      nextStatus: 'resolved',
    });

    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain(
      'WHERE complaint_id = $1 AND user_id = $2 AND status = $3'
    );
    expect(sql).toContain(
      "resolved_at = CASE WHEN $4 = 'resolved' THEN NOW() ELSE NULL END"
    );
    expect(parameters).toEqual([
      'complaint-1',
      'user-1',
      'escalated',
      'resolved',
    ]);
  });
});
