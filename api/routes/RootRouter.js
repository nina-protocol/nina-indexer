import KoaRouter from 'koa-router'
import axios from 'axios'
import { Release } from '@nina-protocol/nina-db'
import { ref } from 'objection'

import AccountRouter from './AccountRouter.js'
import HubRouter from './HubRouter.js'
import PostRouter from './PostRouter.js'
import ReleaseRouter from './ReleaseRouter.js'
import SearchRouter from './SearchRouter.js'
import TagRouter from './TagRouter.js'
import TransactionRouter from './TransactionRouter.js'
import VerificationRouter from './VerificationRouter.js'

const router = new KoaRouter({
  prefix: '/v1'
})

router.use(AccountRouter.routes()).use(AccountRouter.allowedMethods())
router.use(HubRouter.routes()).use(HubRouter.allowedMethods())
router.use(PostRouter.routes()).use(PostRouter.allowedMethods())
router.use(ReleaseRouter.routes()).use(ReleaseRouter.allowedMethods())
router.use(SearchRouter.routes()).use(SearchRouter.allowedMethods())
router.use(TagRouter.routes()).use(TagRouter.allowedMethods())
router.use(TransactionRouter.routes()).use(TransactionRouter.allowedMethods())
router.use(VerificationRouter.routes()).use(VerificationRouter.allowedMethods())

router.get('/health', async (ctx) => {
  ctx.body = {
    status: 'ok'
  }
})

router.get('/solPrice', async (ctx) => {
  try {
    const priceResult = await axios.get(
      `https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112`
    );
    console.log('priceResult', priceResult.data)
    return ctx.body = priceResult.data
  } catch (error) {
    console.log('err', error)
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

router.get('/hash/:md5', async (ctx) => {
  try {
    const { md5 } = ctx.params
    const release = await Release.query()
      .where(ref('metadata:properties.md5Digest').castText(), md5)
      .first()
    ctx.body = {
      release: release ? release : null
    }
  } catch (error) {
    console.warn('hash verify error: ', error)
    ctx.body = {
      release: null
    }
  }
})


export default router