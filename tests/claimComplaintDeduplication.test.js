import { jest } from '@jest/globals';

const dayMs = 24 * 60 * 60 * 1000;
const complaintInput = {
  userId: '12345',
  clientId: 'DITBINMAS',
  platform: 'instagram',
  contentId: 'ABC123',
  issueType: 'activity_not_recorded',
  triage: {
    triage_code: 'ENGAGEMENT_NOT_IN_SNAPSHOT',
    triage_quality: 'medium',
    triage_evidence: { snapshot_available: true },
  },
};

describe('claim complaint lifecycle deduplication', () => {
  let createComplaint;
  let records;
  let now;
  let executedSql;

  beforeEach(async () => {
    jest.resetModules();
    records = [];
    executedSql = [];
    now = Date.parse('2026-08-10T12:00:00.000Z');
    let transactionTail = Promise.resolve();

    const client = {
      query: jest.fn(async (sql, params = []) => {
        executedSql.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (sql.includes('SELECT * FROM claim_complaints')) {
          const [userId, platform, contentId, windowMs] = params;
          const complaint = records
            .filter(
              (record) =>
                record.user_id === userId &&
                record.platform === platform &&
                record.content_id === contentId &&
                record.status !== 'resolved' &&
                now - Date.parse(record.created_at) < windowMs
            )
            .sort(
              (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
            )[0];
          return { rows: complaint ? [complaint] : [] };
        }
        if (sql.includes('INSERT INTO claim_complaints')) {
          const record = {
            complaint_id: params[0],
            user_id: params[1],
            client_id: params[2],
            platform: params[3],
            content_id: params[4],
            status: 'triaged',
            created_at: new Date(now).toISOString(),
          };
          records.push(record);
          return { rows: [record] };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    };
    const withTransaction = jest.fn((callback) => {
      const transaction = transactionTail.then(() => callback(client));
      transactionTail = transaction.catch(() => {});
      return transaction;
    });

    jest.unstable_mockModule('../src/repository/db.js', () => ({
      query: jest.fn(),
      withTransaction,
    }));
    ({ createComplaint } = await import('../src/model/claimComplaintModel.js'));
  });

  test('returns the same active complaint for repeated requests', async () => {
    const first = await createComplaint(complaintInput);
    const repeated = await createComplaint(complaintInput);

    expect(first.created).toBe(true);
    expect(repeated).toEqual({ complaint: first.complaint, created: false });
    expect(records).toHaveLength(1);
    expect(executedSql.join('\n')).toContain("status <> 'resolved'");
    expect(executedSql.join('\n')).toContain("INTERVAL '1 millisecond'");
  });

  test('serializes parallel requests so only one active complaint is inserted', async () => {
    const results = await Promise.all([
      createComplaint(complaintInput),
      createComplaint(complaintInput),
    ]);

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].complaint.complaint_id).toBe(
      results[1].complaint.complaint_id
    );
    expect(records).toHaveLength(1);
    expect(
      executedSql.filter((sql) => sql.includes('pg_advisory_xact_lock'))
    ).toHaveLength(2);
  });

  test('creates a fresh complaint after the previous complaint is resolved', async () => {
    const first = await createComplaint(complaintInput);
    records[0].status = 'resolved';
    const next = await createComplaint(complaintInput);

    expect(next.created).toBe(true);
    expect(next.complaint.complaint_id).not.toBe(first.complaint.complaint_id);
    expect(records).toHaveLength(2);
  });

  test('creates a fresh complaint after the deduplication window expires', async () => {
    const first = await createComplaint(complaintInput);
    now += dayMs + 1;
    const next = await createComplaint(complaintInput);

    expect(next.created).toBe(true);
    expect(next.complaint.complaint_id).not.toBe(first.complaint.complaint_id);
    expect(records).toHaveLength(2);
  });
});

test('deduplication window is an explicit, stable lifecycle constant', async () => {
  const { claimComplaintDeduplicationWindowMs } = await import(
    '../src/config/claimComplaintLifecycle.js'
  );
  expect(claimComplaintDeduplicationWindowMs).toBe(dayMs);
});

test('a duplicate does not enqueue or deliver another created notification', async () => {
  jest.resetModules();
  const existing = { complaint_id: 'complaint-existing', status: 'triaged' };
  const createComplaint = jest.fn().mockResolvedValue({
    complaint: existing,
    created: false,
  });
  const findNotification = jest.fn().mockResolvedValue({ status: 'sent' });
  const deliverClaimComplaintNotification = jest.fn();
  jest.unstable_mockModule('../src/model/claimComplaintModel.js', () => ({
    createComplaint,
    findNotification,
  }));
  jest.unstable_mockModule(
    '../src/service/claimComplaintNotificationService.js',
    () => ({ deliverClaimComplaintNotification })
  );
  const { createOrGetActiveClaimComplaint } = await import(
    '../src/service/claimComplaintLifecycleService.js'
  );

  const result = await createOrGetActiveClaimComplaint({
    ...complaintInput,
    triageSnapshot: complaintInput.triage,
  });

  expect(result).toMatchObject({ complaint: existing, created: false });
  expect(findNotification).toHaveBeenCalledWith(
    'complaint-existing',
    'created'
  );
  expect(deliverClaimComplaintNotification).not.toHaveBeenCalled();
});
