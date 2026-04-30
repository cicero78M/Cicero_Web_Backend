import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { env } from '../config/env.js';
import { query } from '../db/index.js';
import redis from '../config/redis.js';
import routes from '../routes/index.js';
import authRoutes from '../routes/authRoutes.js';
import passwordResetAliasRoutes from '../routes/passwordResetAliasRoutes.js';
import claimRoutes from '../routes/claimRoutes.js';
import adminSystemRoutes from '../routes/adminSystemRoutes.js';
import { notFound, errorHandler } from '../middleware/errorHandler.js';
import { authRequired } from '../middleware/authMiddleware.js';
import { dedupRequest } from '../middleware/dedupRequestMiddleware.js';
import { sensitivePathGuard } from '../middleware/sensitivePathGuard.js';

async function getRedisStatus() {
  try {
    if (typeof redis.ping === 'function') {
      await redis.ping();
      return 'ok';
    }
    if (typeof redis.exists === 'function') {
      await redis.exists('__healthcheck__');
      return 'ok';
    }
    if (typeof redis.get === 'function') {
      await redis.get('__healthcheck__');
      return 'ok';
    }
    return 'unknown';
  } catch {
    return 'error';
  }
}

async function getDbStatus() {
  try {
    await query('SELECT 1 AS ok');
    return 'ok';
  } catch {
    return 'error';
  }
}

export function createApp() {
  const app = express();
  app.disable('etag');
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const corsOrigin = env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const isWildcardCors = corsOrigin.includes('*');
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (isProduction && isWildcardCors) {
    throw new Error('CORS_ORIGIN wildcard (*) is not allowed in production');
  }

  const securityHeaderMiddleware = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };

  const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      success: false,
      message: 'Terlalu banyak percobaan autentikasi. Coba lagi beberapa menit lagi.',
    },
  });

  app.use(cors({
    origin: isWildcardCors
      ? true
      : (origin, callback) => {
          if (!origin || corsOrigin.includes(origin)) {
            callback(null, true);
            return;
          }
          callback(new Error('Origin not allowed by CORS'));
        },
    credentials: true,
  }));

  app.use(securityHeaderMiddleware);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(morgan('dev'));
  app.use(dedupRequest);
  app.use(sensitivePathGuard);

  app.all('/', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.all('/_next/dev/', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    const [db, redisStatus] = await Promise.all([getDbStatus(), getRedisStatus()]);
    const healthy = db === 'ok' && (redisStatus === 'ok' || redisStatus === 'unknown');
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks: {
        db,
        redis: redisStatus,
      },
    });
  });

  app.use('/api/auth', authRateLimiter, authRoutes);
  app.use('/api/claim', authRateLimiter, claimRoutes);
  app.use('/api/password-reset', authRateLimiter, passwordResetAliasRoutes);

  // Admin-system has its own auth middleware inside route module.
  // Keep it outside global `authRequired` so login endpoints remain public.
  app.use('/api/admin-system', adminSystemRoutes);

  app.use('/api', authRequired, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
