import './src/utils/logger.js';
import express from 'express';
import morgan from 'morgan';
import { env } from './src/config/env.js';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import routes from './src/routes/index.js';
import authRoutes from './src/routes/authRoutes.js';
import passwordResetAliasRoutes from './src/routes/passwordResetAliasRoutes.js';
import claimRoutes from './src/routes/claimRoutes.js';
import { notFound, errorHandler } from './src/middleware/errorHandler.js';
import { authRequired } from './src/middleware/authMiddleware.js';
import { dedupRequest } from './src/middleware/dedupRequestMiddleware.js';
import { sensitivePathGuard } from './src/middleware/sensitivePathGuard.js';
import { startOtpWorker } from './src/service/otpQueue.js';

startOtpWorker().catch(err => console.error('[OTP] worker error', err));

const app = express();
app.disable('etag');
app.disable('x-powered-by');
app.set('trust proxy', 1);

const corsOrigin = env.CORS_ORIGIN.split(',')
  .map(origin => origin.trim())
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

app.all('/', (req, res) => res.status(200).json({ status: 'ok' }));
app.all('/_next/dev/', (req, res) => res.status(200).json({ status: 'ok' }));

// ===== ROUTE LOGIN (TANPA TOKEN) =====
app.use('/api/auth', authRateLimiter, authRoutes);
app.use('/api/claim', authRateLimiter, claimRoutes);
app.use('/api/password-reset', authRateLimiter, passwordResetAliasRoutes);

// ===== ROUTE LAIN (WAJIB TOKEN) =====
app.use('/api', authRequired, routes);

// Handler NotFound dan Error
app.use(notFound);
app.use(errorHandler);

const PORT = env.PORT;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
