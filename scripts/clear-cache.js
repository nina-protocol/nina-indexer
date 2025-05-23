import { clearCacheByPattern } from '../utils/redis.js';

const clearAllCaches = async () => {
  try {
    console.log('Clearing all caches...');
    
    // Clear hub search cache
    await clearCacheByPattern('hub:search:*');
    console.log('Cleared hub search cache');
    
    // Clear publisher search cache
    await clearCacheByPattern('publisher:search:*');
    console.log('Cleared publisher search cache');
    
    // Clear release search cache
    await clearCacheByPattern('release:search:*');
    console.log('Cleared release search cache');
    
    console.log('All caches cleared successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error clearing caches:', error);
    process.exit(1);
  }
};

clearAllCaches(); 