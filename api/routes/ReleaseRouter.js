import KoaRouter from 'koa-router'
import { 
  Account,
  Release,
} from '@nina-protocol/nina-db';

import {
  formatColumnForJsonFields,
  getReleaseSearchSubQuery,
  BIG_LIMIT
} from '../utils.js';

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
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching releases'
    }
  }
});

router.get('/sitemap', async (ctx) => {
  try {
    const releases = await Release
      .query()  
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

// TODO: PLUG INTO TRANSACTION SYNCER
router.get('/:publicKeyOrSlug', async (ctx) => {
  try {
    const { txid } = ctx.query;
    let release = await Release.query().findOne({publicKey: ctx.params.publicKeyOrSlug})
    if (!release) {
      release = await Release.query().findOne({slug: ctx.params.publicKeyOrSlug})
    }

    if (txid) {
      await NinaProcessor.init()
      const tx = await NinaProcessor.provider.connection.getParsedTransaction(txid, {

        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      })

      const restrictedReleases = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/restricted`);
      const restrictedReleasesPublicKeys = restrictedReleases.data.restricted.map(x => x.value);

      if (tx && restrictedReleasesPublicKeys.indexOf(ctx.params.publicKeyOrSlug) === -1) {
        try {
          const ninaInstruction = tx.transaction.message.instructions.find(i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID)
          const accounts = ninaInstruction?.accounts
          const blocktime = tx.blockTime
          if (txid && accounts && blocktime) {
            await NinaProcessor.processTransaction(tx, txid, blocktime, accounts)
          }  
        } catch (error) {
          console.log(`tx already in db: ${txid}`)
        }
      }
      release = await Release.findOrCreate(ctx.params.publicKeyOrSlug)
      NinaProcessor.warmCache(release.metadata.image, 5000);
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

// TODO: PLUG INTO TRANSACTION SYNCER
router.get('/:releasePublicKeyOrSlug/collectors/:accountPublicKeyOrSlug', async (ctx) => {
  try {
    if (ctx.query.txId) {
      await processReleaseCollectedTransaction(ctx.query.txId)
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

export default router