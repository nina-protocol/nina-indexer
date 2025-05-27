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
    return Math.min(times * 50, 2000);
  },
  maxRetriesPerRequest: 3,
  connectTimeout: 10000, // 10 seconds
  commandTimeout: 5000,  // 5 seconds
  enableOfflineQueue: false, // Don't queue commands when offline
  enableReadyCheck: true,   // Check if Redis is ready before sending commands
  reconnectOnError: (err) => {
    console.error('[Redis] Reconnect on error:', err);
    return true; // Always try to reconnect
  }
});

// Test Redis connection
const testRedisConnection = async () => {
  try {
    console.log('[Redis] Testing connection...');
    await redis.set('test:connection', 'ok');
    const result = await redis.get('test:connection');
    await redis.del('test:connection');
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
testRedisConnection().then(success => {
  if (!success) {
    console.error('[Redis] Initial connection test failed - Redis may not be fully operational');
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

// Cache wrapper function
export const withCache = async (key, fn) => {
  console.log(`[Cache] Attempting to get/set cache for key: ${key}`);
  try {
    // Try to get from cache first
    console.log(`[Cache] Getting from Redis for key: ${key}`);
    const cachedResult = await redis.get(key);
    console.log(`[Cache] Redis get result for key ${key}:`, cachedResult ? 'Found' : 'Not found');
    
    if (cachedResult) {
      console.log(`[Cache Hit] Found cached result for key: ${key}`);
      try {
        const parsed = JSON.parse(cachedResult);
        console.log(`[Cache] Successfully parsed cached result for key: ${key}`);
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
        console.error(`[Cache Error] Failed to parse cached result for key: ${key}`, parseError);
        console.error(`[Cache Error] Raw cached value:`, cachedResult);
        // If parsing fails, clear the cache and execute the function
        await redis.del(key);
      }
    } else {
      console.log(`[Cache Miss] No cached result found for key: ${key}`);
    }

    // If not in cache or parsing failed, execute the function
    console.log(`[Cache] Executing function for key: ${key}`);
    const result = await fn();
    console.log(`[Cache] Function execution result for key ${key}:`, result ? 'Success' : 'Null/undefined');
    
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

        console.log(`[Cache] Attempting to set cache for key: ${key}`);
        await redis.setex(key, CACHE_TTL, JSON.stringify(toCache));
        console.log(`[Cache Set] Successfully stored result in cache for key: ${key}`);
      } catch (cacheError) {
        console.error(`[Cache Error] Failed to store in cache for key: ${key}`, cacheError);
        console.error(`[Cache Error] Value attempted to cache:`, toCache);
        // Continue execution even if caching fails
      }
    } else {
      console.log(`[Cache] Not caching null/undefined result for key: ${key}`);
    }
    
    return result;
  } catch (error) {
    console.error(`[Cache Error] General error for key: ${key}`, error);
    console.error(`[Cache Error] Stack trace:`, error.stack);
    // If Redis fails, execute the function without caching
    try {
      console.log(`[Cache] Executing function without cache for key: ${key}`);
      return await fn();
    } catch (fnError) {
      console.error(`[Cache Error] Function execution failed for key: ${key}`, fnError);
      throw fnError; // Re-throw the function error to be handled by the caller
    }
  }
};

// Clear cache for a specific key
export const clearCache = async (key) => {
  try {
    await redis.del(key);
    console.log(`[Cache Clear] Cleared cache for key: ${key}`);
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
      console.log(`[Cache Clear] Cleared ${keys.length} keys matching pattern: ${pattern}`);
    }
  } catch (error) {
    console.error('Error clearing cache by pattern:', error);
  }
};

export default redis; 