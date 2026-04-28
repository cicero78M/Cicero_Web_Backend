import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getUsersByClient: jest.fn(),
}));

jest.unstable_mockModule('../src/model/clientModel.js', () => ({
  findAllOrgClients: jest.fn(),
}));

jest.unstable_mockModule('../src/utils/utilsHelper.js', () => ({
  formatNama: jest.fn(),
}));

const { matchesKasatBinmasJabatan } = await import('../src/service/kasatkerAttendanceService.js');

describe('matchesKasatBinmasJabatan', () => {
  test('returns true for plain Kasat Binmas titles', () => {
    expect(matchesKasatBinmasJabatan('Kasat Binmas')).toBe(true);
    expect(matchesKasatBinmasJabatan('KASAT   BINMAS POLRES A')).toBe(true);
    expect(matchesKasatBinmasJabatan('kasatbinmas')).toBe(true);
  });

  test('rejects deputy or modified Kasat Binmas titles', () => {
    expect(matchesKasatBinmasJabatan('WA Kasat Binmas')).toBe(false);
    expect(matchesKasatBinmasJabatan('WAKASAT BINMAS')).toBe(false);
    expect(matchesKasatBinmasJabatan('PJS KASAT BINMAS')).toBe(false);
  });

  test('returns false for unrelated titles', () => {
    expect(matchesKasatBinmasJabatan('Operator')).toBe(false);
    expect(matchesKasatBinmasJabatan('Kasat Intel')).toBe(false);
    expect(matchesKasatBinmasJabatan('')).toBe(false);
  });
});
