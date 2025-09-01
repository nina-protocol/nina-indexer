import { logTimestampedMessage } from '../utils/logging.js';
import "dotenv/config.js";
import Koa from 'koa'
import ratelimit from 'koa-ratelimit';
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors';
import { connectDb, redis } from '@nina-protocol/nina-db';
import cron from 'node-cron';

import RootRouter from './routes/RootRouter.js'
import { environmentIsSetup } from "../scripts/env_check.js";
import TransactionSyncer from '../indexer/src/TransactionSyncer.js';

// Debug environment variables
console.log('Environment Variables:');
console.log('SOLANA_CLUSTER_URL:', process.env.SOLANA_CLUSTER_URL);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('REDIS_URL:', process.env.REDIS_URL);

const app = new Koa()
app.use(cors())
app.use(ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 60000,
  errorMessage:`Casey Jones you better watch your speed`,
  id: (ctx) => {
    return ctx.request.headers['x-id'] || '1'
  },
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  whitelist: (ctx) => {
    if (
      ctx.request.query.api_key === process.env.NINA_API_KEY ||
      ctx.request.headers['x-vercel-id']
    ) {
      return true;
    }

    return false;
  },
  max: 500,
  disableHeader: false,
}));

app.use(bodyParser())
app.use(RootRouter.routes())
app.use(RootRouter.allowedMethods())

try {
  environmentIsSetup()
  app.listen(process.env.PORT, async () => {
    await connectDb()
    redis.startRedis()
    await TransactionSyncer.initialize()
    logTimestampedMessage(`Nina Api listening on port ${process.env.PORT}!`)

    cron.schedule('* * * * *', async() => {
      redis.checkPoolHealth();
    })
  })
} catch (error) {
  console.error('Environment is not properly setup.  Check .env file and try again.')
  console.error(error)
}