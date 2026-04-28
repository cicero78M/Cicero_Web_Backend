import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockGetPostsTodayByClient = jest.fn();
const mockGetCommentsByVideoId = jest.fn();
const mockGetUsersByDirektorat = jest.fn();
const mockGetUsersByClient = jest.fn();
const mockGetClientsByRole = jest.fn();

jest.unstable_mockModule('../src/db/index.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../src/model/tiktokPostModel.js', () => ({
  getPostsTodayByClient: mockGetPostsTodayByClient,
  findPostByVideoId: jest.fn(),
  deletePostByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/model/tiktokCommentModel.js', () => ({
  getCommentsByVideoId: mockGetCommentsByVideoId,
  deleteCommentsByVideoId: jest.fn(),
}));
jest.unstable_mockModule('../src/model/userModel.js', () => ({
  getUsersByDirektorat: mockGetUsersByDirektorat,
  getUsersByClient: mockGetUsersByClient,
  getClientsByRole: mockGetClientsByRole,
}));

let absensiKomentarDitbinmasReport;

beforeAll(async () => {
  ({ absensiKomentarDitbinmasReport } = await import('../src/handler/fetchabsensi/tiktok/absensiKomentarTiktok.js'));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockGetPostsTodayByClient.mockReset();
  mockGetCommentsByVideoId.mockReset();
  mockGetUsersByDirektorat.mockReset();
  mockGetUsersByClient.mockReset();
  mockGetClientsByRole.mockReset();
});

test('aggregates komentar report per division for Ditbinmas with current section ordering and totals', async () => {

  mockQuery.mockResolvedValueOnce({ rows: [{ nama: 'DIREKTORAT BINMAS', client_tiktok: 'ditbinmastiktok' }] });

  mockGetPostsTodayByClient.mockResolvedValueOnce([
    { video_id: 'vid1' },
    { video_id: 'vid2' },
  ]);
  mockGetCommentsByVideoId
    .mockResolvedValueOnce({ comments: [{ username: 'user2' }, { username: 'user3' }, { username: 'user4' }] })
    .mockResolvedValueOnce({ comments: [{ username: 'user2' }, { username: 'user3' }] });
  mockGetUsersByDirektorat.mockResolvedValueOnce([
    { user_id: 'u1', nama: 'User1', tiktok: 'user1', divisi: 'DITBINMAS', client_id: 'DITBINMAS', status: true },
    { user_id: 'u2', nama: 'User2', tiktok: 'user2', divisi: 'DIV A', client_id: 'DITBINMAS', status: true },
    { user_id: 'u3', nama: 'User3', tiktok: 'user3', divisi: 'DIV A', client_id: 'DITBINMAS', status: true },
    { user_id: 'u4', nama: 'User4', tiktok: 'user4', divisi: 'DIV B', client_id: 'DITBINMAS', status: true },
    { user_id: 'u5', nama: 'User5', tiktok: 'user5', divisi: 'DIV B', client_id: 'DITBINMAS', status: true },

  ]);

  const msg = await absensiKomentarDitbinmasReport();

  expect(mockGetUsersByDirektorat).toHaveBeenCalledWith('ditbinmas', 'DITBINMAS');
  expect(msg).toContain('*Jumlah Total Personil:* 5 pers');
  expect(msg).toContain('✅ *Sudah Melaksanakan* : *3 pers*');
  expect(msg).toContain('⚠️ *Melaksanakan kurang lengkap* : *0 pers*');
  expect(msg).toContain('❌ *Belum melaksanakan* : *2 pers*');
  expect(msg).toContain('⚠️❌ *Belum Update Username TikTok* : *0 pers*');
  expect(msg).toContain('⚠️ *Melaksanakan kurang lengkap* : *0 pers*');

  // division headers should still be present in rendered order
  expect(msg).toContain('1. DIV A');
  expect(msg).toContain('2. DIV B');
  expect(msg).toContain('3. DITBINMAS');

  // two divisions should have one person who has not performed
  expect((msg.match(/❌ Belum melaksanakan \(1 pers\)/g) || []).length).toBe(2);
});
