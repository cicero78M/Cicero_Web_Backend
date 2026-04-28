import { env } from './env.js';

const redisUrl = env.REDIS_URL;
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000);
const REDIS_MAX_RETRY_DELAY_MS = Number(process.env.REDIS_MAX_RETRY_DELAY_MS || 3000);

const createSetArgs = (options = {}) => {
  if (!options || typeof options !== 'object') {
    return [];
  }

  const args = [];

  if (typeof options.EX === 'number') {
    args.push('EX', options.EX);
  }

  if (typeof options.PX === 'number') {
    args.push('PX', options.PX);
  }

  return args;
};

const getRetryDelay = (attempt) => {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, attempt) : 0;
  return Math.min(250 * (normalizedAttempt + 1), REDIS_MAX_RETRY_DELAY_MS);
};

const logRedisLifecycle = (client, driverLabel) => {
  if (!client || typeof client.on !== 'function') {
    return;
  }

  client.on('connect', () => {
    console.info(`[Redis] ${driverLabel} connecting to ${redisUrl}`);
  });
  client.on('ready', () => {
    console.info(`[Redis] ${driverLabel} ready`);
  });
  client.on('reconnecting', () => {
    console.warn(`[Redis] ${driverLabel} reconnecting`);
  });
  client.on('end', () => {
    console.warn(`[Redis] ${driverLabel} connection closed`);
  });
  client.on('close', () => {
    console.warn(`[Redis] ${driverLabel} socket closed`);
  });
  client.on('error', (err) => console.error(`[Redis] ${driverLabel} error`, err));
};

const createNodeRedisClient = async () => {
  let nodeRedisModule;

  try {
    nodeRedisModule = await import('redis');
  } catch {
    nodeRedisModule = await import('@redis/client');
  }

  const redis = nodeRedisModule.createClient({
    url: redisUrl,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => {
        const delay = getRetryDelay(retries);
        if (retries === 0 || retries % 10 === 0) {
          console.warn(`[Redis] node-redis reconnect attempt #${retries + 1}, next retry in ${delay}ms`);
        }
        return delay;
      },
    },
  });

  logRedisLifecycle(redis, 'node-redis');

  await redis.connect();
  return redis;
};

const createIoRedisClient = async () => {
  const { default: IORedis } = await import('ioredis');
  const ioRedis = new IORedis(redisUrl, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => {
      const delay = getRetryDelay(times - 1);
      if (times === 1 || times % 10 === 0) {
        console.warn(`[Redis] ioredis reconnect attempt #${times}, next retry in ${delay}ms`);
      }
      return delay;
    },
  });

  logRedisLifecycle(ioRedis, 'ioredis');

  return {
    get: (...args) => ioRedis.get(...args),
    set: (key, value, options = {}) => {
      const setArgs = createSetArgs(options);
      if (setArgs.length === 0) {
        return ioRedis.set(key, value);
      }

      return ioRedis.set(key, value, ...setArgs);
    },
    del: (...args) => ioRedis.del(...args),
    ttl: (...args) => ioRedis.ttl(...args),
    exists: (...args) => ioRedis.exists(...args),
    ping: (...args) => ioRedis.ping(...args),
    sAdd: (key, ...members) => ioRedis.sadd(key, ...members),
    sMembers: (...args) => ioRedis.smembers(...args),
    on: (...args) => ioRedis.on(...args),
    connect: async () => undefined
  };
};

const redis = await (async () => {
  try {
    return await createNodeRedisClient();
  } catch (err) {
    console.error('[Redis] Failed to initialize node-redis client, falling back to ioredis', err);
    return createIoRedisClient();
  }
})();

export default redis;
