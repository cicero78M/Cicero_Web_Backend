import './src/utils/logger.js';
import express from 'express';
import morgan from 'morgan';
import { env } from './src/config/env.js';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import routes from './src/routes/index.js';
import authRoutes from './src/routes/authRoutes.js';
import passwordResetAliasRoutes from './src/routes/passwordResetAliasRoutes.js';
import claimRoutes from './src/routes/claimRoutes.js';
import waHealthRoutes from './src/routes/waHealthRoutes.js';
import { notFound, errorHandler } from './src/middleware/errorHandler.js';
import { authRequired } from './src/middleware/authMiddleware.js';
import { dedupRequest } from './src/middleware/dedupRequestMiddleware.js';
import { sensitivePathGuard } from './src/middleware/sensitivePathGuard.js';
// Import waService to initialize WhatsApp clients at startup
// eslint-disable-next-line no-unused-vars
import { waClient } from './src/service/waService.js';
import { initTelegramBot } from './src/service/telegramService.js';
import { startOtpWorker } from './src/service/otpQueue.js';

// Initialize Telegram bot
initTelegramBot();

startOtpWorker().catch(err => console.error('[OTP] worker error', err));

const app = express();
app.disable('etag');

app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));
app.use(dedupRequest);
app.use(sensitivePathGuard);

app.all('/', (req, res) => res.status(200).json({ status: 'ok' }));
app.all('/_next/dev/', (req, res) => res.status(200).json({ status: 'ok' }));

// ===== ROUTE LOGIN (TANPA TOKEN) =====
app.use('/api/auth', authRoutes);
app.use('/api/claim', claimRoutes);
app.use('/api/password-reset', passwordResetAliasRoutes);
app.use('/api/health/wa', waHealthRoutes);

// ===== ROUTE LAIN (WAJIB TOKEN) =====
app.use('/api', authRequired, routes);

// Handler NotFound dan Error
app.use(notFound);
app.use(errorHandler);

const PORT = env.PORT;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
