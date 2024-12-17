import KoaRouter from 'koa-router'
import { 
  Account,
  Exchange,
  Hub,
  Subscription,
  Transaction,
} from '@nina-protocol/nina-db';
import { ref } from 'objection'

import { formatColumnForJsonFields, BIG_LIMIT } from '../utils.js';

const router = new KoaRouter({
  prefix: '/accounts'
})

router.get('/', async(ctx) => {
  try {
    const { offset=0, limit=20, sort='desc', query= '' } = ctx.query;
    const accounts = await Account
      .query()
      .where('handle', 'ilike', `%${query}%`)
      .orWhere('displayName', 'ilike', `%${query}%`)
      .orderBy('displayName', sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
      
    for await (let account of accounts.results) {
      await account.format();
      account.type = 'account'
    }
    ctx.body = {
      accounts: accounts.results,
      total: accounts.total,
      query
    };

  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching accounts'
    }

  }
})

router.get('/sitemap', async (ctx) => {
  try {
    const accounts = await Account
      .query()  
      .select('handle')
    ctx.body = {
      slugs: accounts.map(account => account.handle),
    };
  } catch(err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching releases for sitemap'
    }
  }
});

router.get('/:publicKeyOrHandle', async (ctx) => {
  try {
    const { v2 } = ctx.query;
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }

    const exchanges = []
    let collected = []
    let published = []
    let hubs = []
    let posts = []
    let revenueShares = []
    let subscriptions = []
    let verifications = []
    if (!v2) {
      const exchangesInitialized = await account.$relatedQuery('exchangesInitialized')
      for await (let exchange of exchangesInitialized) {
        await exchange.format();
        exchanges.push(exchange)
      }
      const exchangesCompleted = await account.$relatedQuery('exchangesCompleted')
      for await (let exchange of exchangesCompleted) {
        await exchange.format();
        exchanges.push(exchange)
      }

      collected = await account.$relatedQuery('collected')
      for await (let release of collected) {
        release.collectedDate = await getCollectedDate(release, account)
        await release.format();
      }

      published = await account.$relatedQuery('published')

      hubs = await account.$relatedQuery('hubs')
      for await (let hub of hubs) {
        await hub.format();
      }
      posts = await account.$relatedQuery('posts')
      for await (let post of posts) {
        await post.format();
      }

      revenueShares = await account.$relatedQuery('revenueShares')

      subscriptions = await Subscription.query()
        .where('from', account.publicKey)
        .orWhere('to', account.publicKey)
      
      for await (let subscription of subscriptions) {
        await subscription.format();
      }  
    }

    verifications = await account.$relatedQuery('verifications').where('active', true)
    for await (let verification of verifications) {
      await verification.format();
    }
    await account.format();
    if (v2) {
      ctx.body = { ...account, verifications };
      return;
    }
    ctx.body = { ...account, collected, published, hubs, posts, exchanges, revenueShares, subscriptions, verifications };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/all', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;

    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }

    const collected = await account.$relatedQuery('collected')
      .orderBy(formatColumnForJsonFields(column), sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
    for await (let release of collected) {
      release.datetime = await getCollectedDate(release, account)
      await release.format();
      release.type = 'release'
    }

    const hubs = await account.$relatedQuery('hubs')
      .orderBy(formatColumnForJsonFields(column, 'data'), sort)
      .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
    for await (let hub of hubs) {
      await hub.format();
      hub.type = 'hub'
    }

    const posts = await account.$relatedQuery('posts')
      .orderBy(formatColumnForJsonFields(column, 'data'), sort)
      .where(ref('data:title').castText(), 'ilike', `%${query}%`)
    for await (let post of posts) {
      await post.format();
      post.type = 'post'
    }

    let published = await account.$relatedQuery('published')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
    for (let release of published) {
      release.type = 'release'
      await release.format()
    }

    const all = [...collected, ...hubs, ...posts, ...published]
    if (sort === 'desc') {
      all.sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
    } else {
      all.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
    }

    ctx.body = { 
      all: all.slice(Number(offset), Number(offset) + Number(limit)),
      total: all.length,
      query,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/collected', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const { txId, releasePublicKey } = ctx.request.query;
    if (txId) {
      await processReleaseCollectedTransaction(txId)
    } else if (releasePublicKey) {
      await NinaProcessor.init();
      const release = await NinaProcessor.program.account.release.fetch(new anchor.web3.PublicKey(releasePublicKey))
      if (release) {
        let tokenAccountsForRelease = await NinaProcessor.tokenIndexProvider.connection.getParsedProgramAccounts(
          new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), {
          commitment: 'confirmed',
          filters: [{
              dataSize: 165
            }, {
              memcmp: {
                offset: 0,
                bytes: release.releaseMint.toBase58()
              }
            }
          ]
        })
        const tokenAccounts = tokenAccountsForRelease.filter(ta => ta.account.data.parsed.info.owner === ctx.params.publicKey)
        if (tokenAccounts.length > 0) {
          let response = await NinaProcessor.tokenIndexProvider.connection.getTokenAccountBalance(tokenAccounts[0].pubkey, 'confirmed')
          if (response.value.uiAmount > 0) {
            await NinaProcessor.addCollectorForRelease(releasePublicKey, ctx.params.publicKey)
          }
        }
      }
    }
    
    const collected = await account.$relatedQuery('collected')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let release of collected.results) {
      release.collectedDate = await getCollectedDate(release, account)
      await release.format();
    }
    ctx.body = {
      collected: collected.results,
      total: collected.total,
      query
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/hubs', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column, 'data');
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const hubs = await account.$relatedQuery('hubs')
      .orderBy(column, sort)
      .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    for await (let hub of hubs.results) {
      await hub.format();
    }
    ctx.body = {
      hubs: hubs.results,
      total: hubs.total,
      query,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/posts', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column, 'data');
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const posts = await account.$relatedQuery('posts')
      .orderBy(column, sort)
      .where(ref('data:title').castText(), 'ilike', `%${query}%`)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
      
    for await (let post of posts.results) {
      await post.format();
    }
    ctx.body = {
      posts: posts.results,
      total: posts.total,
      query,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/published', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    let published = await account.$relatedQuery('published')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let release of published.results) {
      await release.format()
    }

    ctx.body = {
      published: published.results,
      total: published.total,
      query,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/exchanges', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='createdAt' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const exchanges = await Exchange.query()
      .where('completedById', account.id)
      .orWhere('initializerId', account.id)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let exchange of exchanges.results) {
      await exchange.format();
    }
    ctx.body = {
      exchanges: exchanges.results,
      total: exchanges.total,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/revenueShares', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    let revenueShares = await account.$relatedQuery('revenueShares')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    ctx.body = {
      revenueShares: revenueShares.results,
      total: revenueShares.total,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKeyOrHandle/subscriptions', async (ctx) => {
  try {
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
    column = formatColumnForJsonFields(column);
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const subscriptions = await Subscription.query()
      .where('from', account.publicKey)
      .orWhere('to', account.publicKey)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    
    for await (let subscription of subscriptions.results) {
      await subscription.format();
    }

    ctx.body = {
      subscriptions: subscriptions.results,
      total: subscriptions.total,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching subscriptions'
    }
  }
});

router.get('/accounts/:publicKeyOrHandle/following', async (ctx) => {
  try {
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const publicKey = account.publicKey

    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
    column = formatColumnForJsonFields(column);
    const subscriptions = await Subscription.query()
      .where('from', publicKey)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    const following = []
    for await (let subscription of subscriptions.results) {
      if (subscription.subscriptionType === 'account') {
        const account = await Account.findOrCreate(subscription.to);
        delete subscription.id

        await account.format();
        following.push({
          account,
          subscription,
        })
      } else if (subscription.subscriptionType === 'hub') {
        const hub = await Hub.query().findOne({ publicKey: subscription.to });
        delete subscription.id

        await hub.format();
        following.push({
          hub,
          subscription,
        })
      }
    }

    ctx.body = {
      following,
      total: subscriptions.total,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching subscriptions'
    }
  }
});

router.get('/:publicKeyOrHandle/following/:followingPublicKeyOrHandle', async (ctx) => {
  try {
    const { publicKeyOrHandle, followingPublicKeyOrHandle } = ctx.params;
    let account = await Account.query().findOne({publicKey: publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: publicKeyOrHandle});
      if (!account) {
        ctx.status = 404
        ctx.body = {
          success: false,
          following:false,
          message: `Account not found with publicKey: ${publicKeyOrHandle}`
        }
        return;
      }
    }

    let followingAccount = await Account.query().findOne({publicKey: followingPublicKeyOrHandle});
    if (!followingAccount) {
      followingAccount = await Account.query().findOne({handle: followingPublicKeyOrHandle});
      if (!followingAccount) {
        followingAccount = await Hub.query().findOne({publicKey: followingPublicKeyOrHandle});
        if (!followingAccount) {
          followingAccount = await Hub.query().findOne({handle: followingPublicKeyOrHandle});
        }
        if (!followingAccount) {
          ctx.status = 404
          ctx.body = {
            success: false,
            following:false,
            message: `Account not found with publicKey: ${followingPublicKeyOrHandle}`
          }
          return;
        }
      }
    }
    const publicKey = account.publicKey
    const followingPublicKey = followingAccount.publicKey
    const subscriptions = await Subscription.query()
      .where('from', publicKey)
      .andWhere('to', followingPublicKey)

    ctx.body = {
      success: true,
      isFollowing : subscriptions.length > 0,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching user following status',
      success: false,
    }
  }
});

router.get('/:publicKeyOrHandle/followers', async (ctx) => {
  try {
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const publicKey = account.publicKey
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
    column = formatColumnForJsonFields(column);
    const subscriptions = await Subscription.query()
      .where('to', publicKey)
      .orderBy(column, sort)
      .range(Number(offset), Number(offset) + Number(limit) - 1);
    
    const followers = []
    for await (let subscription of subscriptions.results) {
      if (subscription.subscriptionType === 'account') {
        const account = await Account.findOrCreate(subscription.from);
        await account.format();
        delete subscription.id

        followers.push({
          account,
          subscription,
        })
      }
    }

    ctx.body = {
      followers,
      total: subscriptions.total,
    };
  } catch (err) {
    console.log(err)
    ctx.status = 400
    ctx.body = {
      message: 'Error fetching subscriptions'
    }
  }
});

router.get('/:publicKeyOrHandle/verifications', async (ctx) => {
  try {
    const { offset=0, limit=BIG_LIMIT } = ctx.query;
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const verifications = await account.$relatedQuery('verifications')
      .where('active', true)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let verification of verifications.results) {
      await verification.format();
    }
    ctx.body = {
      verifications: verifications.results,
      total: verifications.total,
    };
  } catch (err) {
    console.log(err)
    accountNotFound(ctx)
  }
});

router.get('/:publicKey/feed', async (ctx) => {
  try {
    const { limit=50, offset=0 } = ctx.query;
    const account = await Account.findOrCreate(ctx.params.publicKey);
    const subscriptions = await Subscription.query()
      .where('from', account.publicKey)

    const hubIds = []
    const accountIds = []

    for await (let subscription of subscriptions) {
      if (subscription.subscriptionType === 'hub') {
        const hub = await Hub.query().findOne({ publicKey: subscription.to })
        hubIds.push(hub.id)
      } else if (subscription.subscriptionType === 'account') {
        const account = await Account.query().findOne({ publicKey: subscription.to })
        accountIds.push(account.id)
      }
    }
    const notUserSubquery = Transaction.query()
      .select('id')
      .where('authorityId', account.id)

    const transactions = await Transaction.query()
      .where((builder) => 
        builder
          .whereIn('hubId', hubIds)
          .orWhereIn('toHubId', hubIds)
          .orWhereIn('authorityId', accountIds)
          .orWhereIn('toAccountId', accountIds)
      )
      .whereNotIn('id', notUserSubquery)
      .orderBy('blocktime', 'desc')
      .range(Number(offset), Number(offset) + Number(limit))

    const feedItems = []
    const releaseIds = new Set()
    for await (let transaction of transactions.results) {
      await transaction.format()
      if (transaction.releaseId && !releaseIds.has(transaction.releaseId)) {
        releaseIds.add(transaction.releaseId)
      }
      feedItems.push(transaction)
    }
    ctx.body = {
      feedItems,
      total: transactions.total
    };
  } catch (err) {
    console.log('err', err)
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

router.get('/:publicKeyOrHandle/following/newReleases', async (ctx) => {
  try {
    const { limit=50, offset=0 } = ctx.query;
    let account = await Account.query().findOne({publicKey: ctx.params.publicKeyOrHandle});
    if (!account) {
      account = await Account.query().findOne({handle: ctx.params.publicKeyOrHandle});
      if (!account) {
        accountNotFound(ctx);
        return;
      }
    }
    const subscriptions = await Subscription.query()
      .where('from', account.publicKey)

    const hubIds = []
    const accountIds = []

    for await (let subscription of subscriptions) {
      if (subscription.subscriptionType === 'hub') {
        const hub = await Hub.query().findOne({ publicKey: subscription.to })
        hubIds.push(hub.id)
      } else if (subscription.subscriptionType === 'account') {
        const account = await Account.query().findOne({ publicKey: subscription.to })
        accountIds.push(account.id)
      }
    }
    const notUserSubquery = Transaction.query()
      .select('id')
      .where('authorityId', account.id)

    const transactions = await Transaction.query()
      .where((builder) => 
        builder
          .whereIn('hubId', hubIds)
          .orWhereIn('toHubId', hubIds)
          .orWhereIn('authorityId', accountIds)
          .orWhereIn('toAccountId', accountIds)
      )
      .whereIn('type', ['ReleaseInit', 'ReleaseInitViaHub', 'ReleaseInitWithCredit'])
      .whereNotIn('id', notUserSubquery)
      .orderBy('blocktime', 'desc')
      .range(Number(offset), Number(offset) + Number(limit))

    
    const feedItems = []
    for await (let transaction of transactions.results) {
      await transaction.format()
      feedItems.push(transaction)
    }

    const releases = []
    for (let transaction of feedItems) {
      if (transaction.release) {
        releases.push(transaction.release)
      }
    }
    ctx.body = {
      releases,
      total: transactions.total
    };
  } catch (err) {
    console.log('err', err)
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

router.get('/:publicKey/activity', async (ctx) => {
  try {
    const { limit=50, offset=0 } = ctx.query;
    const account = await Account.findOrCreate(ctx.params.publicKey);
    const releases = await account.$relatedQuery('revenueShares')
    const hubs = await account.$relatedQuery('hubs')
    const transactions = await Transaction.query()
      .whereIn('releaseId', releases.map(release => release.id))
      .orWhereIn('hubId', hubs.map(hub => hub.id))
      .orWhere('authorityId', account.id)
      .orWhere('toAccountId', account.id)
      .orWhereIn('toHubId', hubs.map(hub => hub.id))
      .orderBy('blocktime', 'desc')
      .range(offset, offset + limit)

    const activityItems = []
    for await (let transaction of transactions.results) {
      await transaction.format()
      activityItems.push(transaction)
    }

    ctx.body = {
      activityItems,
      total: transactions.total
    };
  } catch (err) {
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

router.get('/:publicKey/hubSuggestions', async (ctx) => {
  try {
    const suggestions = {}
    let shouldAddRecommendations = false
    const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
    if (account) {
      const mySubscriptions = await Subscription.query().where('from', account.publicKey)
      const collected = await account.$relatedQuery('collected')
      for await (let release of collected) {
        const hubs = await release.$relatedQuery('hubs')
          .whereNotIn('publicKey', mySubscriptions.map(subscription => subscription.to))
          .andWhereNot('authorityId', account.id)
        await addSuggestionsBatch(suggestions, hubs, 'collected', account)
      }

      const published = await account.$relatedQuery('published')
      for await (let release of published) {
        const hubs = await release.$relatedQuery('hubs')
          .whereNotIn('publicKey', mySubscriptions.map(subscription => subscription.to))
          .andWhereNot('authorityId', account.id)
        await addSuggestionsBatch(suggestions, hubs, 'published', account)

        const collectors = await release.$relatedQuery('collectors')
        for await (let collector of collectors) {
          const collectorHubs = await collector
            .$relatedQuery('hubs')
            .whereNotIn('publicKey', mySubscriptions.map(subscription => subscription.to))
            .andWhereNot('authorityId', account.id)
          await addSuggestionsBatch(suggestions, collectorHubs, 'collectorHub', account)
        }
      }
      const hubs = await account.$relatedQuery('hubs')
      for await (let hub of hubs) {
        const releases = await hub.$relatedQuery('releases')
        for await (let release of releases) {
          const relatedHubs = await release.$relatedQuery('hubs')
            .whereNotIn('publicKey', mySubscriptions.map(subscription => subscription.to))
            .andWhereNot('authorityId', account.id)
          await addSuggestionsBatch(suggestions, relatedHubs, 'hubRelease', account)
        }
      }

      for await (let mySubscription of mySubscriptions) {
        if (mySubscription.subscriptionType === 'hub') {
          const relatedSubscriptions = await Subscription.query().where('to', mySubscription.to)
          for await (let relatedSubscription of relatedSubscriptions) {
            const relatedHubSubscriptions = await Subscription.query()
              .whereNotIn('to', mySubscriptions.map(subscription => subscription.to))
              .andWhere('from', relatedSubscription.from)
              .andWhere('subscriptionType', 'hub')
            for await (let relatedHubSubscription of relatedHubSubscriptions) {
              const hub = await Hub.query().findOne({ publicKey: relatedHubSubscription.to })
              await addSuggestion(suggestions, hub, 'hubSubscription', account)
            }
          }  
        } else {
          const relatedHubSubscriptions = await Subscription.query()
            .whereNotIn('to', mySubscriptions.map(subscription => subscription.to))
            .andWhere('from', mySubscription.to)
            .andWhere('subscriptionType', 'hub')
          for await (let relatedHubSubscription of relatedHubSubscriptions) {
            const hub = await Hub.query().findOne({ publicKey: relatedHubSubscription.to })
            await addSuggestion(suggestions, hub, 'hubSubscription', account)
          }
        }
      }
    } else {
      shouldAddRecommendations = true
    }

    if (Object.values(suggestions).length < 15 || shouldAddRecommendations) {
      const ninaRecommendedHubSubscriptions = await Subscription.query()
        .where('from', process.env.HUB_SUGGESTIONS_PUBLIC_KEY)
        .andWhere('subscriptionType', 'hub')
      for await (let ninaRecommendedHubSubscription of ninaRecommendedHubSubscriptions) {
        if (Object.values(suggestions).filter(suggestion => suggestion.hub.publicKey === ninaRecommendedHubSubscription.to).length === 0) {
          const hub = await Hub.query().findOne({ publicKey: ninaRecommendedHubSubscription.to })
          await hub.format()
          suggestions[hub.publicKey] = {
            hub,
          }
        }
      }
    }
    
    const sortedHubs = Object.values(suggestions).sort((a, b) => ((b.hubReleaseCount + b.collectedCount + b.publishedCount + b.collectorHubCount + b.hubSubscriptionCount) - (a.hubReleaseCount + a.collectedCount + a.publishedCount + a.collectorHubCount + a.hubSubscriptionCount)))
    ctx.body = { suggestions: sortedHubs };    
  } catch (err) {
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})


// helper functions

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

const accountNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    success: false,
    message: `Account not found with publicKey: ${ctx.params.publicKey}`
  }
}

const processReleaseCollectedTransaction = async (txId) => {
  try {
    await NinaProcessor.init();
    const tx = await NinaProcessor.provider.connection.getParsedTransaction(txId, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    })
    if (tx) {
      let accounts = tx.transaction.message.instructions.find(i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID)?.accounts
      if (accounts && tx.meta.logMessages.some(log => log.includes('ReleasePurchase'))) {
        let releasePublicKey = accounts[2].toBase58()
        let accountPublicKey = accounts[1].toBase58()
        await NinaProcessor.addCollectorForRelease(releasePublicKey, accountPublicKey)
      } else if (accounts && tx.meta.logMessages.some(log => log.includes('ReleaseClaim'))) {
        let releasePublicKey = accounts[1].toBase58()
        let accountPublicKey = accounts[3].toBase58()
        await NinaProcessor.addCollectorForRelease(releasePublicKey, accountPublicKey)
      } else if (!accounts || accounts.length === 0) {
        for (let innerInstruction of tx.meta.innerInstructions) {
          for (let instruction of innerInstruction.instructions) {
            if (instruction.programId.toBase58() === process.env.NINA_PROGRAM_ID) {
              console.log('found release purchase in inner instructions (ReleasePurchaseCoinflow)')
              accounts = instruction.accounts
            }
          }
        }
        let releasePublicKey = accounts[2].toBase58()
        let accountPublicKey = accounts[1].toBase58()
        await NinaProcessor.addCollectorForRelease(releasePublicKey, accountPublicKey)
      }
    }
  } catch (error) {
    console.error('Error processing release collected transaction', error)
  }
}

const addSuggestionsBatch = async (suggestions, hubs, type, account) => {
  for await (let hub of hubs) {
    addSuggestion(suggestions, hub, type, account)
  }
}

const addSuggestion = async (suggestions, hub, type, account) => {
  if (suggestions[hub.publicKey]) {
    suggestions[hub.publicKey][`${type}Count`] = suggestions[hub.publicKey][`${type}Count`] + 1
  } else {
    await hub.format()
    if (hub.authority !== account.publicKey) {
      const suggestion = {
        collectedCount: 0,
        hubReleaseCount: 0,
        publishedCount: 0,
        collectorHubCount: 0,
        hubSubscriptionCount: 0,
        hub,
      }
      suggestion[`${type}Count`] = 1
      suggestions[hub.publicKey] = suggestion
    }
  }
}


export default router