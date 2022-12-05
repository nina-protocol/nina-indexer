require('dotenv/config');
const Koa = require('koa')
const KoaRouter = require('koa-router')
const ratelimit = require('koa-ratelimit');
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors');
const { connectDb } = require('../indexer/db/index');

const registerApi = require('./api');

const router = new KoaRouter({
  prefix: '/v1'
})
const app = new Koa()
app.use(cors())
const db = new Map();
app.use(ratelimit({
  driver: 'memory',
  db: db,
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

app.listen(process.env.PORT, async () => {
  await connectDb()
  console.log(`Nina Api listening on port ${process.env.PORT}!`)
})