module.exports = {
  apps: [
    {
      name: 'nina-indexer',
      script: 'indexer/src/index.js',
      max_memory_restart: '1536M',
      args: '-- start:indexer:heapstats',
      env: {
        // will be temporarily written to during pm2 env configuration
        NODE_ENV: 'production'
      }
    },
    {
      name: 'nina-api',
      script: 'api/index.js',
      max_memory_restart: '1536M',
      env: {
        // will be temporarily written to during pm2 env configuration
        NODE_ENV: 'production',
        REDIS_URL: process.env.REDIS_URL
      }
    }
  ],
};