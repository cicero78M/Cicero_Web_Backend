import jwt from 'jsonwebtoken';
import redis from '../config/redis.js';

export async function verifyPenmasToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token required' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }

  let exists;
  try {
    exists = await redis.get(`login_token:${token}`);
  } catch (redisErr) {
    console.error('[AUTH] Redis unavailable in verifyPenmasToken:', redisErr);
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  if (!exists || !String(exists).startsWith('penmas:')) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  req.penmasUser = payload;
  next();
}
