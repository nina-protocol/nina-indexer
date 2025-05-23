import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL = 7200; // 2 hours in seconds

// Create Redis client
const redis = new Redis(REDIS_URL);

// Handle Redis connection events
redis.on('connect', () => {
  console.log('Connected to Redis');
});

redis.on('error', (error) => {
  console.error('Redis connection error:', error);
});

// Cache wrapper function
export const withCache = async (key, fn) => {
  try {
    // Try to get from cache first
    const cachedResult = await redis.get(key);
    if (cachedResult) {
      console.log(`[Cache Hit] Found cached result for key: ${key}`);
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
        console.error('Error parsing cached result:', parseError);
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
        console.log(`[Cache Set] Stored result in cache for key: ${key}`);
      } catch (cacheError) {
        console.error('Error storing in cache:', cacheError);
        // Continue execution even if caching fails
      }
    }
    
    return result;
  } catch (error) {
    console.error('Cache error:', error);
    // If Redis fails, execute the function without caching
    try {
      return await fn();
    } catch (fnError) {
      console.error('Function execution error:', fnError);
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