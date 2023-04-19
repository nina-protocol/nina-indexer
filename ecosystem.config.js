module.exports = {
  apps: [{
    name: 'nina-indexer',
    script: 'indexer/index.js',
    max_memory_restart: '2048M'
  },
  {
    name: 'nina-api',
    script: 'api/index.js',
    max_memory_restart: '2048M'
  }]
};