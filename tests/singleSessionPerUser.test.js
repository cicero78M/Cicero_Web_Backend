import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcrypt';

const mockQuery = jest.fn();
const mockRedis = { 
  sAdd: jest.fn(), 
  set: jest.fn(), 
  sMembers: jest.fn(), 
  del: jest.fn() 
};
const mockInsertLoginLog = jest.fn();
const mockGetPremiumSnapshot = jest.fn();
const actualWaHelper = await import('../src/utils/waHelper.js');

jest.unstable_mockModule('../src/db/index.js', () => ({
  query: mockQuery
}));

jest.unstable_mockModule('../src/config/redis.js', () => ({
  default: mockRedis
}));

jest.unstable_mockModule('../src/model/loginLogModel.js', () => ({
  insertLoginLog: mockInsertLoginLog,
  getLoginLogs: jest.fn()
}));

jest.unstable_mockModule('../src/utils/waHelper.js', () => ({
  ...actualWaHelper,
  formatToWhatsAppId: (nohp) => `${nohp}@c.us`
}));

jest.unstable_mockModule('../src/service/dashboardSubscriptionService.js', () => ({
  getPremiumSnapshot: mockGetPremiumSnapshot,
}));

let app;
let authRoutes;

beforeAll(async () => {
  process.env.JWT_SECRET = 'testsecret';
  const mod = await import('../src/routes/authRoutes.js');
  authRoutes = mod.default;
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockRedis.sAdd.mockReset();
  mockRedis.set.mockReset();
  mockRedis.sMembers.mockReset();
  mockRedis.del.mockReset();
  mockRedis.sMembers.mockResolvedValue([]);
  mockRedis.del.mockResolvedValue(1);
  mockInsertLoginLog.mockReset();
  mockGetPremiumSnapshot.mockReset();
  mockGetPremiumSnapshot.mockResolvedValue({
    premiumStatus: false,
    premiumTier: null,
    premiumExpiresAt: null,
  });
});

describe('Single Session Per User', () => {
  test('dashboard login clears existing sessions before creating new one', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          dashboard_user_id: 'dash-user-1',
          username: 'dashuser',
          password_hash: passwordHash,
          status: true,
          role: 'operator',
          role_id: 1,
          client_ids: ['client-1']
        }]
      })
      .mockResolvedValueOnce({
        rows: [{ client_type: 'regular' }]
      });
    
    // Mock existing tokens
    mockRedis.sMembers.mockResolvedValueOnce(['old-token-1', 'old-token-2']);
    mockRedis.del.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dashuser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Verify that sMembers was called to get existing tokens
    expect(mockRedis.sMembers).toHaveBeenCalledWith('dashboard_login:dash-user-1');
    
    // Verify that del was called for each old token
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-1');
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-2');
    
    // Verify that del was called for the session key
    expect(mockRedis.del).toHaveBeenCalledWith('dashboard_login:dash-user-1');
    
    // Verify new token was added
    expect(mockRedis.sAdd).toHaveBeenCalled();
    expect(mockRedis.set).toHaveBeenCalled();
  });

  test('penmas login clears existing sessions before creating new one', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          user_id: 'penmas-user-1',
          username: 'penmasuser',
          password_hash: passwordHash,
          role: 'penulis'
        }]
      });
    
    // Mock existing tokens
    mockRedis.sMembers.mockResolvedValueOnce(['old-token-1']);
    mockRedis.del.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/auth/penmas-login')
      .send({ username: 'penmasuser', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Verify that sMembers was called to get existing tokens
    expect(mockRedis.sMembers).toHaveBeenCalledWith('penmas_login:penmas-user-1');
    
    // Verify that del was called for old token
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-1');
    
    // Verify that del was called for the session key
    expect(mockRedis.del).toHaveBeenCalledWith('penmas_login:penmas-user-1');
    
    // Verify new token was added
    expect(mockRedis.sAdd).toHaveBeenCalledWith('penmas_login:penmas-user-1', expect.any(String));
  });

  test('client login clears existing sessions before creating new one', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        client_id: 'client-1',
        nama: 'Test Client',
        client_operator: '08123456789'
      }]
    });
    
    // Mock existing tokens
    mockRedis.sMembers.mockResolvedValueOnce(['old-token-1', 'old-token-2', 'old-token-3']);
    mockRedis.del.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ client_id: 'client-1', client_operator: '08123456789' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Verify that sMembers was called to get existing tokens
    expect(mockRedis.sMembers).toHaveBeenCalledWith('login:client-1');
    
    // Verify that del was called for each old token
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-1');
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-2');
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-3');
    
    // Verify that del was called for the session key
    expect(mockRedis.del).toHaveBeenCalledWith('login:client-1');
    
    // Verify new token was added
    expect(mockRedis.sAdd).toHaveBeenCalledWith('login:client-1', expect.any(String));
  });

  test('user login clears existing sessions before creating new one', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        user_id: 'user-1',
        nama: 'Test User',
        whatsapp: '62812345678'
      }]
    });
    
    // Mock existing tokens
    mockRedis.sMembers.mockResolvedValueOnce(['old-token-1']);
    mockRedis.del.mockResolvedValue(1);

    const res = await request(app)
      .post('/api/auth/user-login')
      .send({ nrp: 'user-1', whatsapp: '0812345678' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Verify that sMembers was called to get existing tokens
    expect(mockRedis.sMembers).toHaveBeenCalledWith('user_login:user-1');
    
    // Verify that del was called for old token
    expect(mockRedis.del).toHaveBeenCalledWith('login_token:old-token-1');
    
    // Verify that del was called for the session key
    expect(mockRedis.del).toHaveBeenCalledWith('user_login:user-1');
    
    // Verify new token was added
    expect(mockRedis.sAdd).toHaveBeenCalledWith('user_login:user-1', expect.any(String));
  });

  test('login with no existing sessions still works', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        client_id: 'client-2',
        nama: 'New Client',
        client_operator: '08123456789'
      }]
    });
    
    // Mock no existing tokens
    mockRedis.sMembers.mockResolvedValueOnce([]);
    mockRedis.del.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ client_id: 'client-2', client_operator: '08123456789' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Verify new token was added
    expect(mockRedis.sAdd).toHaveBeenCalledWith('login:client-2', expect.any(String));
    expect(mockRedis.set).toHaveBeenCalled();
  });

  test('redis error during session clear does not prevent login', async () => {
    const passwordHash = await bcrypt.hash('password123', 10);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          dashboard_user_id: 'dash-user-2',
          username: 'dashuser2',
          password_hash: passwordHash,
          status: true,
          role: 'operator',
          role_id: 1,
          client_ids: ['client-1']
        }]
      })
      .mockResolvedValueOnce({
        rows: [{ client_type: 'regular' }]
      });
    
    // Mock redis error during clear
    mockRedis.sMembers.mockRejectedValueOnce(new Error('Redis connection error'));

    const res = await request(app)
      .post('/api/auth/dashboard-login')
      .send({ username: 'dashuser2', password: 'password123' });

    // Login should still succeed despite redis error
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // New token should still be added
    expect(mockRedis.sAdd).toHaveBeenCalled();
  });
});
