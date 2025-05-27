import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_TTL = 7200; // 2 hours in seconds
const POOL_SIZE = 10;
const CONNECTION_TIMEOUT = 5000; // 5 seconds
const OPERATION_TIMEOUT = 10000; // 10 seconds

// Track pool health
let failedConnections = 0;
let lastErrorTime = null;
const MAX_FAILURES = 5;
const FAILURE_WINDOW = 60000; // 1 minute

// Alert thresholds
const ALERT_THRESHOLDS = {
  MIN_ACTIVE_CONNECTIONS: 5,  // Alert if less than 5 active connections
  MAX_FAILED_CONNECTIONS: 3,  // Alert if more than 3 failed connections
  ERROR_WINDOW: 5 * 60 * 1000 // 5 minutes
};

// Create Redis connection pool
const createRedisPool = (size = POOL_SIZE) => {
  const pool = [];
  let activeConnections = 0;
  
  for (let i = 0; i < size; i++) {
    const client = new Redis(REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 1000, 5000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      connectTimeout: CONNECTION_TIMEOUT,
      commandTimeout: OPERATION_TIMEOUT,
      enableOfflineQueue: true,
      enableReadyCheck: true,
      reconnectOnError: (err) => {
        console.error('[Redis] Reconnect on error:', err);
        return true;
      },
      lazyConnect: true,
      keepAlive: 10000
    });

    client.on('error', (error) => {
      console.error(`[Redis Pool Client ${i}] Error:`, error);
      failedConnections++;
      
      // Check if we're having too many failures
      const now = Date.now();
      if (lastErrorTime && (now - lastErrorTime) < FAILURE_WINDOW) {
        if (failedConnections >= MAX_FAILURES) {
          console.error('[Redis] Too many failures in short time, removing client from pool');
          const index = pool.indexOf(client);
          if (index > -1) {
            pool.splice(index, 1);
            client.disconnect();
          }
        }
      } else {
        // Reset failure count if outside window
        failedConnections = 1;
        lastErrorTime = now;
      }
    });

    client.on('connect', () => {
      activeConnections++;
      console.log(`[Redis] Client ${i} connected. Active connections: ${activeConnections}`);
    });

    client.on('close', () => {
      activeConnections--;
      console.log(`[Redis] Client ${i} disconnected. Active connections: ${activeConnections}`);
    });

    client.on('timeout', () => {
      console.error(`[Redis] Client ${i} timed out`);
      client.disconnect();
    });

    pool.push(client);
  }
  return pool;
};

// Create the pool
const redisPool = createRedisPool();
let isPoolInitialized = false;

// Get a client from the pool using round-robin with timeout
let currentClientIndex = 0;
let totalRequests = 0;
const getClient = () => {
  if (!isPoolInitialized) {
    throw new Error('Redis pool not initialized');
  }

  if (redisPool.length === 0) {
    throw new Error('No available Redis connections in pool');
  }

  const client = redisPool[currentClientIndex];
  currentClientIndex = (currentClientIndex + 1) % redisPool.length;
  totalRequests++;
  
  // Log every 1000 requests
  if (totalRequests % 1000 === 0) {
    console.log(`[Redis] Total requests processed: ${totalRequests}`);
  }
  
  return client;
};

// Health check function
export const checkPoolHealth = () => {
  const health = {
    totalConnections: redisPool.length,
    activeConnections: redisPool.filter(client => client.status === 'ready').length,
    failedConnections,
    lastErrorTime,
    timestamp: new Date().toISOString()
  };

  // Check for problems and log
  if (health.activeConnections < ALERT_THRESHOLDS.MIN_ACTIVE_CONNECTIONS) {
    console.error(`[Redis CRITICAL] Low active connections: ${health.activeConnections}/${POOL_SIZE}. Pool may be exhausted.`);
  }

  if (health.failedConnections > ALERT_THRESHOLDS.MAX_FAILED_CONNECTIONS) {
    console.error(`[Redis CRITICAL] High number of failed connections: ${health.failedConnections}. Redis may be having issues.`);
  }

  if (health.lastErrorTime && (Date.now() - health.lastErrorTime) < ALERT_THRESHOLDS.ERROR_WINDOW) {
    console.error(`[Redis WARNING] Recent Redis errors detected. Last error: ${new Date(health.lastErrorTime).toISOString()}`);
  }

  // Log health status
  console.log('[Redis] Pool Health:', {
    ...health,
    lastErrorTime: health.lastErrorTime ? new Date(health.lastErrorTime).toISOString() : null
  });

  return health;
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
  try {
    console.log('[Redis] Initializing pool...');
    const results = await Promise.all(redisPool.map(client => testRedisConnection()));
    const successCount = results.filter(Boolean).length;
    
    if (successCount === 0) {
      throw new Error('Failed to initialize any Redis connections');
    }
    
    if (successCount < redisPool.length) {
      console.warn(`[Redis] Only ${successCount}/${redisPool.length} connections initialized successfully`);
    }
    
    isPoolInitialized = true;
    console.log('[Redis] Pool initialization completed');
  } catch (error) {
    console.error('[Redis] Pool initialization failed:', error);
    throw error;
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

// Cleanup function to properly close all connections
export const cleanupPool = async () => {
  console.log('[Redis] Starting pool cleanup...');
  isPoolInitialized = false;
  
  try {
    const closePromises = redisPool.map(async (client, index) => {
      try {
        await client.quit();
        console.log(`[Redis] Client ${index} closed successfully`);
      } catch (error) {
        console.error(`[Redis] Error closing client ${index}:`, error);
        // Force close if quit fails
        try {
          await client.disconnect();
        } catch (disconnectError) {
          console.error(`[Redis] Error force disconnecting client ${index}:`, disconnectError);
        }
      }
    });

    await Promise.all(closePromises);
    console.log('[Redis] Pool cleanup completed');
  } catch (error) {
    console.error('[Redis] Error during pool cleanup:', error);
    throw error;
  }
};

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('[Redis] Received SIGTERM signal');
  await cleanupPool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Redis] Received SIGINT signal');
  await cleanupPool();
  process.exit(0);
});

// Handle PM2 restarts and crashes
process.on('uncaughtException', async (error) => {
  console.error('[Redis] Uncaught Exception:', error);
  await cleanupPool();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('[Redis] Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanupPool();
  process.exit(1);
});

// Handle PM2 graceful shutdown
if (process.env.NODE_ENV === 'production') {
  process.on('message', async (msg) => {
    if (msg === 'shutdown') {
      console.log('[Redis] Received PM2 shutdown message');
      await cleanupPool();
      process.exit(0);
    }
  });
}

// Initialize the pool
initializePool().catch(error => {
  console.error('[Redis] Failed to initialize pool:', error);
  process.exit(1);
});

// Run health check every 5 minutes
setInterval(() => {
  checkPoolHealth();
}, 5 * 60 * 1000);

// Run health check on startup
checkPoolHealth();

export default {
  getClient,
  withCache,
  batchGet,
  batchSet,
  clearCache,
  clearCacheByPattern,
  cleanupPool,
  checkPoolHealth
}; 