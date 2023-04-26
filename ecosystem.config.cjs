module.exports = {
  apps: [
    {
      name: 'nina-indexer',
      script: 'indexer/index.js',
      max_memory_restart: '1536M',
      args: '-- start:indexer:heapstats',
      pm2_discord: {
        url: process.env.DISCORD_WEBHOOK_URL,
        events: {
          restart: true,
        },
      },
    },
    {
      name: 'nina-api',
      script: 'api/index.js',
      max_memory_restart: '1536M',
      pm2_discord: {
        url: process.env.DISCORD_WEBHOOK_URL,
        events: {
          restart: true,
        },
      },
    },
  ],
};
