const { resolveLinkReportMutationUserId } = await import(
  '../src/service/linkReportIdentityService.js'
);

describe('resolveLinkReportMutationUserId', () => {
  test('role user selalu menggunakan user_id dari token', () => {
    const req = { user: { role: 'user', user_id: 'token-user' } };

    expect(resolveLinkReportMutationUserId(req, 'other-user')).toBe('token-user');
  });

  test('role user tetap kompatibel ketika payload tidak mengirim user_id', () => {
    const req = { user: { role: 'USER', user_id: 'token-user' } };

    expect(resolveLinkReportMutationUserId(req, undefined)).toBe('token-user');
  });

  test('role operator mempertahankan target user pada payload lama', () => {
    const req = { user: { role: 'operator', user_id: 'operator-1' } };

    expect(resolveLinkReportMutationUserId(req, 'target-user')).toBe('target-user');
  });

  test('role user tanpa identitas token ditolak', () => {
    expect(() =>
      resolveLinkReportMutationUserId({ user: { role: 'user' } }, 'other-user')
    ).toThrow(expect.objectContaining({ statusCode: 401 }));
  });

  test('role non-user tanpa target mempertahankan validasi user_id lama', () => {
    expect(() =>
      resolveLinkReportMutationUserId({ user: { role: 'operator' } }, undefined)
    ).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
