import { env } from './env.js';

const redisUrl = env.REDIS_URL;
const REDIS_CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000);
const REDIS_MAX_RETRY_DELAY_MS = Number(process.env.REDIS_MAX_RETRY_DELAY_MS || 3000);
const LOGIN_SESSION_TTL_SEC = Number(process.env.LOGIN_SESSION_TTL_SEC || 2 * 60 * 60);
const SESSION_SET_KEY_PREFIXES = [
  'dashboard_login:',
  'claim_login:',
  'penmas_login:',
  'login:',
  'user_login:',
];

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

const isSessionSetKey = (key) =>
  typeof key === 'string' && SESSION_SET_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));

const applySessionSetTtl = async (client, key) => {
  if (!isSessionSetKey(key) || typeof client?.expire !== 'function') {
    return;
  }

  try {
    await client.expire(key, LOGIN_SESSION_TTL_SEC);
  } catch (err) {
    console.warn(`[Redis] Failed to refresh TTL for session set ${key}: ${err.message}`);
  }
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

  if (typeof redis.sAdd === 'function') {
    const originalSAdd = redis.sAdd.bind(redis);
    redis.sAdd = async (key, ...members) => {
      const result = await originalSAdd(key, ...members);
      await applySessionSetTtl(redis, key);
      return result;
    };
  }

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
    incr: (...args) => ioRedis.incr(...args),
    ttl: (...args) => ioRedis.ttl(...args),
    exists: (...args) => ioRedis.exists(...args),
    expire: (...args) => ioRedis.expire(...args),
    ping: (...args) => ioRedis.ping(...args),
    sAdd: async (key, ...members) => {
      const result = await ioRedis.sadd(key, ...members);
      await applySessionSetTtl(ioRedis, key);
      return result;
    },
    sMembers: (...args) => ioRedis.smembers(...args),
    on: (...args) => ioRedis.on(...args),
    connect: async () => undefined
  };
};

const createInMemoryTestClient = () => {
  const values = new Map();
  const sets = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
      return 'OK';
    },
    del: async (...keys) => {
      let deleted = 0;
      for (const key of keys) {
        deleted += Number(values.delete(key));
        deleted += Number(sets.delete(key));
      }
      return deleted;
    },
    incr: async (key) => {
      const next = Number(values.get(key) || 0) + 1;
      values.set(key, String(next));
      return next;
    },
    ttl: async () => -1,
    exists: async (key) => Number(values.has(key) || sets.has(key)),
    expire: async (key) => Number(values.has(key) || sets.has(key)),
    ping: async () => 'PONG',
    sAdd: async (key, ...members) => {
      const set = sets.get(key) || new Set();
      const previousSize = set.size;
      members.flat().forEach((member) => set.add(member));
      sets.set(key, set);
      return set.size - previousSize;
    },
    sMembers: async (key) => [...(sets.get(key) || [])],
    sRem: async (key, ...members) => {
      const set = sets.get(key);
      if (!set) return 0;
      let removed = 0;
      members.flat().forEach((member) => {
        removed += Number(set.delete(member));
      });
      return removed;
    },
    on: () => undefined,
    connect: async () => undefined,
    quit: async () => 'OK',
    disconnect: async () => undefined,
  };
};

const redis = process.env.NODE_ENV === 'test'
  ? createInMemoryTestClient()
  : await (async () => {
      try {
        return await createNodeRedisClient();
      } catch (err) {
        console.error(
          '[Redis] Failed to initialize node-redis client, falling back to ioredis',
          err,
        );
        return createIoRedisClient();
      }
    })();

export default redis;
