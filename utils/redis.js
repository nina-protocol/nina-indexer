import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL = 7200; // 2 hours in seconds

// Create Redis connection pool
const createRedisPool = (size = 10) => {
  const pool = [];
  let activeConnections = 0;
  
  for (let i = 0; i < size; i++) {
    const client = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 1000, 5000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: 20000,
      commandTimeout: 10000,
      enableOfflineQueue: true,
      enableReadyCheck: true,
      reconnectOnError: (err) => {
        console.error('[Redis] Reconnect on error:', err);
        return true;
      },
      lazyConnect: true
    });

    client.on('error', (error) => {
      console.error(`[Redis Pool Client ${i}] Error:`, error);
    });

    client.on('connect', () => {
      activeConnections++;
      console.log(`[Redis] Client ${i} connected. Active connections: ${activeConnections}`);
    });

    client.on('close', () => {
      activeConnections--;
      console.log(`[Redis] Client ${i} disconnected. Active connections: ${activeConnections}`);
    });

    pool.push(client);
  }
  return pool;
};

// Create the pool
const redisPool = createRedisPool();

// Get a client from the pool using round-robin
let currentClientIndex = 0;
let totalRequests = 0;
const getClient = () => {
  const client = redisPool[currentClientIndex];
  currentClientIndex = (currentClientIndex + 1) % redisPool.length;
  totalRequests++;
  
  // Log every 1000 requests
  if (totalRequests % 1000 === 0) {
    console.log(`[Redis] Total requests processed: ${totalRequests}`);
  }
  
  return client;
};

// Test Redis connection
const testRedisConnection = async () => {
  const client = getClient();
  try {
    await client.set('test:connection', 'ok', 'EX', 10);
    const result = await client.get('test:connection');
    return result === 'ok';
  } catch (error) {
    console.error('[Redis] Connection test failed:', error);
    return false;
  }
};

// Initialize all clients
const initializePool = async () => {
  for (const client of redisPool) {
    await testRedisConnection();
  }
};

// Cache wrapper function
export const withCache = async (key, fn) => {
  const client = getClient();
  try {
    // Try to get from cache first
    const cachedResult = await client.get(key);
    
    if (cachedResult) {
      try {
        const parsed = JSON.parse(cachedResult);
        if (Array.isArray(parsed)) {
          return parsed.map(id => {
            if (typeof id === 'object' && id !== null) {
              return id.id;
            }
            return typeof id === 'string' ? parseInt(id, 10) : id;
          }).filter(id => !isNaN(id));
        }
        return parsed;
      } catch (parseError) {
        await client.del(key);
      }
    }

    const result = await fn();
    
    if (result != null) {
      try {
        const toCache = Array.isArray(result) 
          ? result.map(id => {
              if (typeof id === 'object' && id !== null) {
                return id.id;
              }
              return typeof id === 'string' ? parseInt(id, 10) : id;
            }).filter(id => !isNaN(id))
          : result;

        await client.setex(key, CACHE_TTL, JSON.stringify(toCache));
      } catch (cacheError) {
        console.error('[Redis] Cache error:', cacheError);
      }
    }
    
    return result;
  } catch (error) {
    try {
      return await fn();
    } catch (fnError) {
      throw fnError;
    }
  }
};

// Batch operations
export const batchGet = async (keys) => {
  const client = getClient();
  try {
    const pipeline = client.pipeline();
    keys.forEach(key => pipeline.get(key));
    const results = await pipeline.exec();
    return results.map(([err, result]) => {
      if (err) return null;
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    });
  } catch (error) {
    console.error('[Redis] Batch get error:', error);
    return keys.map(() => null);
  }
};

export const batchSet = async (entries) => {
  const client = getClient();
  try {
    const pipeline = client.pipeline();
    entries.forEach(([key, value]) => {
      pipeline.setex(key, CACHE_TTL, JSON.stringify(value));
    });
    await pipeline.exec();
  } catch (error) {
    console.error('[Redis] Batch set error:', error);
  }
};

// Clear cache for a specific key
export const clearCache = async (key) => {
  const client = getClient();
  try {
    await client.del(key);
  } catch (error) {
    console.error('[Redis] Clear cache error:', error);
  }
};

// Clear cache by pattern
export const clearCacheByPattern = async (pattern) => {
  const client = getClient();
  try {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      const pipeline = client.pipeline();
      keys.forEach(key => pipeline.del(key));
      await pipeline.exec();
    }
  } catch (error) {
    console.error('[Redis] Clear cache by pattern error:', error);
  }
};

// Initialize the pool
initializePool().catch(console.error);

export default {
  getClient,
  withCache,
  batchGet,
  batchSet,
  clearCache,
  clearCacheByPattern
}; 