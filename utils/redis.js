import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL = 7200; // 2 hours in seconds

console.log('Initializing Redis with URL:', REDIS_URL);
console.log('REDIS_URL:', REDIS_URL);

// Create Redis client
const redis = new Redis(REDIS_URL, {
  retryStrategy: (times) => {
    console.log(`[Redis] Retry attempt ${times}`);
    const delay = Math.min(times * 1000, 5000);
    console.log(`[Redis] Retrying in ${delay}ms`);
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

// Test Redis connection
const testRedisConnection = async () => {
  try {
    console.log('[Redis] Testing connection...');
    // Wait for Redis to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis ready timeout'));
      }, 10000);

      if (redis.status === 'ready') {
        clearTimeout(timeout);
        resolve();
      } else {
        redis.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      }
    });

    await redis.set('test:connection', 'ok', 'EX', 10);
    const result = await redis.get('test:connection');
    if (result === 'ok') {
      console.log('[Redis] Connection test successful');
      return true;
    } else {
      console.error('[Redis] Connection test failed - unexpected result:', result);
      return false;
    }
  } catch (error) {
    console.error('[Redis] Connection test failed:', error);
    console.error('[Redis] Error stack:', error.stack);
    return false;
  }
};

// Run connection test on startup
let isInitialized = false;
redis.on('ready', async () => {
  if (!isInitialized) {
    isInitialized = true;
    const success = await testRedisConnection();
    if (!success) {
      console.error('[Redis] Initial connection test failed - Redis may not be fully operational');
    }
  }
});

// Handle Redis connection events
redis.on('connect', () => {
  console.log('Successfully connected to Redis');
});

redis.on('ready', () => {
  console.log('Redis client is ready to accept commands');
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
  console.error('Redis URL being used:', REDIS_URL);
  console.error('Redis error stack:', error.stack);
});

redis.on('close', () => {
  console.log('Redis connection closed');
});

redis.on('reconnecting', () => {
  console.log('[Redis] Attempting to reconnect...');
});

// Cache wrapper function
export const withCache = async (key, fn) => {
  try {
    // Try to get from cache first
    const cachedResult = await redis.get(key);
    
    if (cachedResult) {
      try {
        const parsed = JSON.parse(cachedResult);
        // Ensure arrays of IDs are properly formatted
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
        // If parsing fails, clear the cache and execute the function
        await redis.del(key);
      }
    }

    // If not in cache or parsing failed, execute the function
    const result = await fn();
    
    // Only cache if result is not null/undefined
    if (result != null) {
      try {
        // Ensure arrays of IDs are properly formatted before caching
        const toCache = Array.isArray(result) 
          ? result.map(id => {
              if (typeof id === 'object' && id !== null) {
                return id.id;
              }
              return typeof id === 'string' ? parseInt(id, 10) : id;
            }).filter(id => !isNaN(id))
          : result;

        await redis.setex(key, CACHE_TTL, JSON.stringify(toCache));
      } catch (cacheError) {
        // Continue execution even if caching fails
      }
    }
    
    return result;
  } catch (error) {
    // If Redis fails, execute the function without caching
    try {
      return await fn();
    } catch (fnError) {
      throw fnError; // Re-throw the function error to be handled by the caller
    }
  }
};

// Clear cache for a specific key
export const clearCache = async (key) => {
  try {
    await redis.del(key);
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
};

// Clear cache by pattern
export const clearCacheByPattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (error) {
    console.error('Error clearing cache by pattern:', error);
  }
};

export default redis; 