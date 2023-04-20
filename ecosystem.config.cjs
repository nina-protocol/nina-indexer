module.exports = {
  apps: [
    {
      name: 'nina-indexer',
      script: 'indexer/index.js',
      max_memory_restart: '1536M',
      args: '-- start:indexer:heapstats',
    },
    {
      name: 'nina-api',
      script: 'api/index.js',
      max_memory_restart: '1536M',
    },
  ],
};
