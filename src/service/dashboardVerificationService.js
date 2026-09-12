import crypto from 'crypto';
import IORedis from 'ioredis';
import { env } from '../config/env.js';
import redis from '../config/redis.js';
import { sendOtpEmail } from './emailService.js';

const OTP_TTL_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const keyFor = (userId, channel) => `dashboard_verification:otp:${userId}:${channel}`;
const cooldownKeyFor = (userId, channel) => `dashboard_verification:cooldown:${userId}:${channel}`;
const rateKeyFor = (userId, channel) => `dashboard_verification:rate:${userId}:${channel}`;

function normalizeChannel(channel) {
  const value = String(channel || '').trim().toLowerCase();
  if (!['email', 'whatsapp'].includes(value)) throw new Error('Channel verifikasi tidak valid');
  return value;
}

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

export async function issueDashboardOtp({ dashboardUserId, channel, target }) {
  const safeChannel = normalizeChannel(channel);
  const safeTarget = String(target || '').trim();
  if (!safeTarget) throw new Error(`Data ${safeChannel} belum diisi`);

  const cooldown = await redis.get(cooldownKeyFor(dashboardUserId, safeChannel));
  if (cooldown) {
    const remaining = await redis.ttl(cooldownKeyFor(dashboardUserId, safeChannel));
    const error = new Error(`Tunggu ${Math.max(1, remaining)} detik sebelum meminta OTP lagi`);
    error.statusCode = 429;
    throw error;
  }

  const rateKey = rateKeyFor(dashboardUserId, safeChannel);
  const sends = await redis.incr(rateKey);
  if (sends === 1) await redis.expire(rateKey, 3600);
  if (sends > MAX_SENDS_PER_HOUR) {
    const error = new Error('Batas pengiriman OTP tercapai. Coba lagi nanti');
    error.statusCode = 429;
    throw error;
  }

  const otp = String(crypto.randomInt(100000, 1000000));
  await redis.set(keyFor(dashboardUserId, safeChannel), JSON.stringify({
    target: safeTarget,
    hash: hashOtp(otp),
    attempts: 0,
  }), { EX: OTP_TTL_SECONDS });
  await redis.set(cooldownKeyFor(dashboardUserId, safeChannel), '1', { EX: RESEND_COOLDOWN_SECONDS });

  if (safeChannel === 'email') {
    await sendOtpEmail(safeTarget, otp);
  } else {
    await enqueueWhatsappOtp(safeTarget, otp);
  }
  return { expiresIn: OTP_TTL_SECONDS, resendAfter: RESEND_COOLDOWN_SECONDS };
}

async function enqueueWhatsappOtp(target, otp) {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  try {
    const { Queue } = await import('bullmq');
    const queue = new Queue('wa-outbox', { connection });
    const digits = target.replace(/\D/g, '');
    const jid = `${digits.startsWith('0') ? `62${digits.slice(1)}` : digits}@s.whatsapp.net`;
    await queue.add('send', { jid, payload: { text: `Kode OTP CICERO Anda: ${otp}. Berlaku 5 menit. Jangan bagikan kode ini.` } }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });
  } finally {
    await connection.quit().catch(() => {});
  }
}

export async function verifyDashboardOtp({ dashboardUserId, channel, target, otp }) {
  const safeChannel = normalizeChannel(channel);
  const key = keyFor(dashboardUserId, safeChannel);
  const raw = await redis.get(key);
  if (!raw) throw Object.assign(new Error('OTP tidak ditemukan atau sudah kedaluwarsa'), { statusCode: 400 });
  const record = JSON.parse(raw);
  if (record.target !== String(target || '').trim()) {
    throw Object.assign(new Error('Target verifikasi berubah. Minta OTP baru'), { statusCode: 400 });
  }
  if (!/^\d{6}$/.test(String(otp || ''))) {
    throw Object.assign(new Error('OTP harus terdiri dari 6 digit'), { statusCode: 400 });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    throw Object.assign(new Error('Batas percobaan OTP tercapai. Minta OTP baru'), { statusCode: 429 });
  }
  if (hashOtp(otp) !== record.hash) {
    record.attempts += 1;
    await redis.set(key, JSON.stringify(record), { EX: await redis.ttl(key) });
    throw Object.assign(new Error('OTP tidak sesuai'), { statusCode: 400 });
  }
  await redis.del(key);
  return true;
}
