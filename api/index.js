import "dotenv/config.js";
import Koa from 'koa'
import KoaRouter from 'koa-router'
import ratelimit from 'koa-ratelimit';
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors';
import { connectDb } from '@nina-protocol/nina-db';

import registerApi from './api.js';
import { environmentIsSetup } from "../scripts/env_check.js";
import { logger } from '../indexer/utils.js';

const router = new KoaRouter({
  prefix: '/'
})
const app = new Koa()
app.use(cors())
app.use(ratelimit({
  driver: 'memory',
  db: new Map(),
  duration: 60000,
  errorMessage:`Casey Jones you better watch your speed`,
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total'
  },
  whitelist: (ctx) => {
    if (
      ctx.request.header.host.includes('ninaprotocol.com') ||
      ctx.request.query.api_key === process.env.NINA_API_KEY
    ) {
      return true;
    }

    return false;
  },
  max: 1000,
  disableHeader: false,
}));

registerApi(router)
app.use(bodyParser())
app.use(router.routes())
app.use(router.allowedMethods())

try {
  environmentIsSetup()
  app.listen(process.env.PORT, async () => {
    await connectDb()
    logger(`Nina Api listening on port ${process.env.PORT}!`)
  })
} catch (error) {
  logger(`Environment is not properly setup.  Check .env file and try again. ${error}`)
}