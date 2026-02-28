import { env } from './env.js';

const redisUrl = env.REDIS_URL;

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

const createNodeRedisClient = async () => {
  let nodeRedisModule;

  try {
    nodeRedisModule = await import('redis');
  } catch {
    nodeRedisModule = await import('@redis/client');
  }

  const redis = nodeRedisModule.createClient({ url: redisUrl });
  redis.on('error', (err) => console.error('Redis Client Error', err));

  await redis.connect();
  return redis;
};

const createIoRedisClient = async () => {
  const { default: IORedis } = await import('ioredis');
  const ioRedis = new IORedis(redisUrl);

  ioRedis.on('error', (err) => console.error('Redis Client Error', err));

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
