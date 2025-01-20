import KoaRouter from 'koa-router'
import { 
  Transaction,
} from '@nina-protocol/nina-db';
import _  from 'lodash';


const router = new KoaRouter({
  prefix: '/transactions'
})

router.get('/feed', async (ctx) => {
  try {
    const { limit=50, offset=0 } = ctx.query;
    const transactions = await Transaction.query()
      .orderBy('blocktime', 'desc')
      .range(Number(offset), Number(offset) + Number(limit))

    const feedItems = []
    for await (let transaction of transactions.results) {
      await transaction.format()
      feedItems.push(transaction)
    }
    
    ctx.body = {
      feedItems,
      total: transactions.total
    };
  } catch (error) {
    console.log('err', err)
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

export default router