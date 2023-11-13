module.exports = {
  apps: [
    {
      name: 'nina-indexer',
      script: 'indexer/index.js',
      max_memory_restart: '1536M',
      args: '-- start:indexer:heapstats',
      env: {
        // Will be temporarily written to during pm2 env configuration
      }
    },
    {
      name: 'nina-api',
      script: 'api/index.js',
      max_memory_restart: '1536M',
      env: {
        // Will be temporarily written to during pm2 env configuration
      }
    },
  ],
};
