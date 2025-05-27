import redis from './utils/redis.js';

(async () => {
  try {
    await redis.set('testkey', 'testvalue');
    const val = await redis.get('testkey');
    console.log('Test Redis value:', val);
    process.exit(0);
  } catch (err) {
    console.error('Test Redis error:', err);
    process.exit(1);
  }
})(); 