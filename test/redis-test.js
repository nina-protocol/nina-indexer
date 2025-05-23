import Redis from 'ioredis';

const redis = new Redis('redis://localhost:6379');

console.log('Attempting to connect to Redis...');

redis.ping()
  .then(() => {
    console.log('Successfully connected to Redis!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to connect to Redis:', error);
    process.exit(1);
  }); 