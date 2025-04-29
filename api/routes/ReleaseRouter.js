import KoaRouter from 'koa-router'
import { 
  Account,
  Exchange,
  Hub,
  Release,
  Transaction,
} from '@nina-protocol/nina-db';
import axios from 'axios';
import {
  formatColumnForJsonFields,
  getReleaseSearchSubQuery,
  BIG_LIMIT
} from '../utils.js';
import { warmCache } from '../../indexer/src/utils/helpers.js';
import TransactionSyncer from '../../indexer/src/TransactionSyncer.js';

import _ from 'lodash';
import knex from 'knex'
import knexConfig from '../../db/src/knexfile.js'

const authDb = knex(knexConfig.development.auth)

const idList = [
  '13572',
]

const router = new KoaRouter({
  prefix: '/releases'
})

router.get('/', async (ctx) => {
  try {
    let { offset=0, limit=20, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column);

    const releases = await Release.query()
      .where('archived', false)
      .whereNotIn('publisherId', idList)
      .whereIn('id', getReleaseSearchSubQuery(query))
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let release of releases.results) {
      await release.format();
      release.type = 'release'     
    }
      
    ctx.body = {
      releases: releases.results,
      total: releases.total,
      query
    };
  } catch(err) {
    console.log(err);
    ctx.status = 400;
    ctx.body = {
      message: 'Error fetching releases'
    };
  }
});

router.get('/sitemap', async (ctx) => {
  try {
    const restrictedReleases = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/restricted`);
    const restrictedReleasesPublicKeys = restrictedReleases.data.restricted.map(x => x.value);

    const releases = await Release
      .query()
      .where('archived', false)
      .whereNotIn('publicKey', restrictedReleasesPublicKeys)
      .select('slug')
      .orderBy('datetime', 'desc')
    ctx.body = {
      slugs: releases.map(release => release.slug),
    };
  } catch(err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching releases for sitemap'
    }
  }
});

router.get('/:publicKeyOrSlug', async (ctx) => {
  try {
    const { txid } = ctx.query;
    let release = await Release.query().findOne({publicKey: ctx.params.publicKeyOrSlug})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKeyOrSlug})
    }

    if (txid) {
      const success = await TransactionSyncer.handleDomainProcessingForSingleTransaction(txid)
      if (success) {
        release = await Release.findOrCreate(ctx.params.publicKeyOrSlug)
        warmCache(release.metadata.image, 5000);
      }
    }
    
    if (release) {
      await release.format();
      
      ctx.body = {
        release,
      }
    } else {
      throw new Error(`Release not found with publicKeyOrSlug: ${ctx.params.publicKeyOrSlug}`)
    }
} catch (err) {
    console.log(`/releases/:publicKey Error: publicKeyOrSlug: ${ctx.params.publicKeyOrSlug} ${err}`)
    ctx.status = 404
    ctx.body = {
      message: `Release not found with publicKeyOrSlug: ${ctx.params.publicKeyOrSlug}`
    }
  }
});

router.get('/:publicKeyOrSlug/posts', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let release = await Release.query().findOne({publicKey: ctx.params.publicKeyOrSlug})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKeyOrSlug})
    }
    if (!release) {
      throw new Error(`Release not found with identifier: ${ctx.params.publicKeyOrSlug}`)
    }
    const posts = await release.$relatedQuery('posts')
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let post of posts.results) {
      await post.format();
    }
    ctx.body = {
      posts: posts.results,
      total: posts.total,
    };
  } catch (error) {
    console.error('GET /releases/:publicKeyOrSlug/articles', error)
    ctx.status = 404
    ctx.body = {
      message: `Release not found with identifier: ${ctx.params.publicKeyOrSlug}`
    }
  }
})

router.get('/:publicKey/collectors', async (ctx) => {
  try {
    const { offset=0, limit=BIG_LIMIT } = ctx.query;

    let release = await Release.query().findOne({publicKey: ctx.params.publicKey})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKey})
      
      if (!release) {
        throw new Error(`Release not found with identifier: ${ctx.params.publicKey}`)
      }
    }
    const collectors = await release.$relatedQuery('collectors')
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let account of collectors.results) {
      if (ctx.request.query.withCollection) {
        const collectedReleases = await account.$relatedQuery('collected')
        const collectedPublicKeys = collectedReleases.map(release => release.publicKey)
        account.collection = collectedPublicKeys
      }
      account.collectedDate = await getCollectedDate(release, account)
      await account.format();
    }
    ctx.body = {
      collectors: collectors.results,
      total: collectors.total,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 404
    ctx.body = {
      message: `Release not found with publicKey: ${ctx.params.publicKey}`
    }
  }
});

router.get('/:releasePublicKeyOrSlug/collectors/:accountPublicKeyOrSlug', async (ctx) => {
  try {
    if (ctx.query.txId) {
      await TransactionSyncer.handleDomainProcessingForSingleTransaction(ctx.query.txId)
    }

    let account = await Account.query().findOne({publicKey: ctx.params.accountPublicKeyOrSlug})
    if (!account) {
      throw new Error(`Account not found with identifier: ${ctx.params.accountPublicKeyOrSlug}`)
    }
    let release = await Release.query().findOne({publicKey: ctx.params.releasePublicKeyOrSlug})
    if (!release) {
      throw new Error(`Release not found with identifier: ${ctx.params.releasePublicKeyOrSlug}`)
    }

    const collector = await account.$relatedQuery('collected')
      .where('releaseId', release.id)
      .first();
    if (!collector) {
      throw new Error(`Collector not found with publicKey: ${ctx.params.accountPublicKeyOrSlug} and releaseId: ${release.id}`)
    }

    ctx.body = {
      collected: collector ? true : false,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 404
    ctx.body = {
      message: `Collector not found with publicKey: ${ctx.params.accountPublicKeyOrSlug}`,
      collected: false
    }
  }
})

router.get('/:publicKey/hubs', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let release = await Release.query().findOne({publicKey: ctx.params.publicKey})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKey})
      
      if (!release) {
        throw new Error(`Release not found with identifier: ${ctx.params.publicKey}`)
      }
    }

    const hubs = await release.$relatedQuery('hubs')
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let hub of hubs.results) {
      await hub.format();
    }
    ctx.body = {
      hubs: hubs.results,
      total: hubs.total,
    };
  } catch (error) {
    console.log(error)
    ctx.status = 404
    ctx.body = {
      message: `Release not found with identifier: ${ctx.params.publicKey}`
    }
  }
})

router.get('/:publicKey/revenueShareRecipients', async (ctx) => {
  try {
    const { offset=0, limit=BIG_LIMIT } = ctx.query;
    let release = await Release.query().findOne({publicKey: ctx.params.publicKey})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKey})
      
      if (!release) {
        throw new Error(`Release not found with identifier: ${ctx.params.publicKey}`)
      }
    }
    
    const revenueShareRecipients = await release.$relatedQuery('revenueShareRecipients')
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let account of revenueShareRecipients.results) {
      await account.format();
    }
    ctx.body = {
      revenueShareRecipients: revenueShareRecipients.results,
      total: revenueShareRecipients.total,
    };
  } catch (error) {
    console.log(error)
    ctx.status = 404
    ctx.body = {
      message: `Release not found with publicKey: ${ctx.params.publicKey}`
    }
  }
})

const getCollectedDate = async (release, account) => {
  let purchaseTransactions = []
  const exchanges = await Exchange.query().where('releaseId', release.id)
  const releasePurchaseTxs = await Transaction.query()
    .where('releaseId', release.id)
    .andWhere('authorityId', account.id)
    .andWhere('type', 'ReleasePurchase')
  purchaseTransactions = purchaseTransactions.concat(releasePurchaseTxs.map(tx => tx.blocktime))

  const releasePurchaseViaHubTxs = await Transaction.query()
    .where('releaseId', release.id)
    .andWhere('authorityId', account.id)
    .andWhere('type', 'ReleasePurchaseViaHub')
  purchaseTransactions = purchaseTransactions.concat(releasePurchaseViaHubTxs.map(tx => tx.blocktime))

  for await (let exchange of exchanges) {
    const initializer = await exchange.$relatedQuery('initializer')
    const completedBy = await exchange.$relatedQuery('completedBy')

    if ((exchange.isSale && completedBy?.publicKey === account.publicKey) || 
        (!exchange.isSale && initializer?.publicKey === account.publicKey)
    ) {
      const blocktime = new Date(exchange.completedAt).getTime() / 1000
      purchaseTransactions.push(blocktime)
    }
  }

  const earliestPurchaseTx = purchaseTransactions.sort((a, b) => a - b)[0]
  if (earliestPurchaseTx) {
    return new Date(earliestPurchaseTx * 1000).toISOString()
  }
  return release.datetime
}

export default router