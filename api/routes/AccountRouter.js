import KoaRouter from 'koa-router'
import { 
  Account,
  Exchange,
  Hub,
  Release,
  Subscription,
  Transaction,
  SubscriptionsWithCache,
} from '@nina-protocol/nina-db';
import { ref } from 'objection'
import * as anchor from '@project-serum/anchor';
import TransactionSyncer from '../../indexer/src/TransactionSyncer.js';
import { callRpcMethodWithRetry } from '../../indexer/src/utils/index.js';

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
    const { v2, archived, full='false' } = ctx.query;
    const includeBlocks = full === 'true';
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
        await post.format({ includeBlocks });
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
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='', archived=false, full='false' } = ctx.query;
    const includeBlocks = full === 'true';

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
      .where('archived', Boolean(archived))
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
      await post.format({ includeBlocks });
      post.type = 'post'
    }

    let published = await account.$relatedQuery('published')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
      .where('archived', Boolean(archived))

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
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='', showArchived=false } = ctx.query;
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
      await TransactionSyncer.handleDomainProcessingForSingleTransaction(txId)
    } else if (releasePublicKey) {
      const release = await Release.query().findOne({publicKey: releasePublicKey})
      if (release) {
        let tokenAccountsForRelease = await callRpcMethodWithRetry(() => TransactionSyncer.provider.connection.getParsedProgramAccounts(
          new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), {
          commitment: 'confirmed',
          filters: [{
              dataSize: 165
            }, {
              memcmp: {
                offset: 0,
                bytes: release.mint
              }
            }
          ]
        }))
        const tokenAccounts = tokenAccountsForRelease.filter(ta => ta.account.data.parsed.info.owner === account.publicKey)
        if (tokenAccounts.length > 0) {
          let response = await callRpcMethodWithRetry(() => TransactionSyncer.provider.connection.getTokenAccountBalance(tokenAccounts[0].pubkey, 'confirmed'))
          if (response.value.uiAmount > 0) {
            await release.$relatedQuery('collectors').relate(account.id)
          }
        }
      }
    }
    
    const collected = await account.$relatedQuery('collected')
      .orderBy(column, sort)
      .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
      .whereIn('archived', Boolean(showArchived) ? [true, false] : [false])
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
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='', full='false' } = ctx.query;
    const includeBlocks = full === 'true';
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
      .where('archived', false)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    for await (let post of posts.results) {
      await post.format({ includeBlocks });
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
    let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='', showArchived=false } = ctx.query;
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
      .whereIn('archived', Boolean(showArchived) ? [true, false] : [false])
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

router.get('/:publicKeyOrHandle/following', async (ctx) => {
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

router.get('/:publicKeyOrHandle/following/:followingPublicKeyOrHandle', async (ctx) => {
  try {
    const { publicKeyOrHandle, followingPublicKeyOrHandle } = ctx.params;
    const isFollowing = await SubscriptionsWithCache.getUserFollowingAccountWithCache(publicKeyOrHandle, followingPublicKeyOrHandle)
    ctx.body = {
      success: true,
      isFollowing,
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
    const { followers, total } = await SubscriptionsWithCache.getFollowersForAccountWithCache(ctx.params.publicKeyOrHandle, ctx.query)
    ctx.body = {
      followers,
      total,
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
      const mySubscriptionTos = mySubscriptions.map(subscription => subscription.to)
      
      // Batch fetch all related data upfront
      const collected = await account.$relatedQuery('collected')
      const published = await account.$relatedQuery('published')
      const hubs = await account.$relatedQuery('hubs')
      
      // Process collected releases
      for await (let release of collected) {
        const releaseHubs = await release.$relatedQuery('hubs')
          .whereNotIn('publicKey', mySubscriptionTos)
          .andWhereNot('authorityId', account.id)
        await addSuggestionsBatch(suggestions, releaseHubs, 'collected', account)
      }

      // Process published releases
      for await (let release of published) {
        const releaseHubs = await release.$relatedQuery('hubs')
          .whereNotIn('publicKey', mySubscriptionTos)
          .andWhereNot('authorityId', account.id)
        await addSuggestionsBatch(suggestions, releaseHubs, 'published', account)

        const collectors = await release.$relatedQuery('collectors')
        for await (let collector of collectors) {
          const collectorHubs = await collector
            .$relatedQuery('hubs')
            .whereNotIn('publicKey', mySubscriptionTos)
            .andWhereNot('authorityId', account.id)
          await addSuggestionsBatch(suggestions, collectorHubs, 'collectorHub', account)
        }
      }
      
      // Process hub releases
      for await (let hub of hubs) {
        const hubReleases = await hub.$relatedQuery('releases')
        for await (let release of hubReleases) {
          const relatedHubs = await release.$relatedQuery('hubs')
            .whereNotIn('publicKey', mySubscriptionTos)
            .andWhereNot('authorityId', account.id)
          await addSuggestionsBatch(suggestions, relatedHubs, 'hubRelease', account)
        }
      }

      // Optimize subscription-based suggestions
      const hubSubscriptions = mySubscriptions.filter(sub => sub.subscriptionType === 'hub')
      const accountSubscriptions = mySubscriptions.filter(sub => sub.subscriptionType === 'account')
      
      if (hubSubscriptions.length > 0) {
        // Batch fetch all related subscriptions for hub subscriptions
        const hubTos = hubSubscriptions.map(sub => sub.to)
        const relatedSubscriptions = await Subscription.query()
          .whereIn('to', hubTos)
          .andWhere('subscriptionType', 'account')
        
        // Group by 'to' for efficient processing
        const subscriptionsByTo = relatedSubscriptions.reduce((acc, sub) => {
          if (!acc[sub.to]) acc[sub.to] = []
          acc[sub.to].push(sub)
          return acc
        }, {})
        
        // Batch fetch all related hub subscriptions
        const relatedFroms = relatedSubscriptions.map(sub => sub.from)
        const allRelatedHubSubscriptions = await Subscription.query()
          .whereIn('from', relatedFroms)
          .whereNotIn('to', mySubscriptionTos)
          .andWhere('subscriptionType', 'hub')
        
        // Process hub subscription suggestions
        for (const relatedHubSub of allRelatedHubSubscriptions) {
          const hub = await Hub.query().findOne({ publicKey: relatedHubSub.to })
          await addSuggestion(suggestions, hub, 'hubSubscription', account)
        }
      }
      
      if (accountSubscriptions.length > 0) {
        // Batch fetch hub subscriptions for account subscriptions
        const accountTos = accountSubscriptions.map(sub => sub.to)
        const relatedHubSubscriptions = await Subscription.query()
          .whereIn('from', accountTos)
          .whereNotIn('to', mySubscriptionTos)
          .andWhere('subscriptionType', 'hub')
        
        // Batch fetch all related hubs
        const hubPublicKeys = relatedHubSubscriptions.map(sub => sub.to)
        const relatedHubs = await Hub.query().whereIn('publicKey', hubPublicKeys)
        
        for (const hub of relatedHubs) {
          await addSuggestion(suggestions, hub, 'hubSubscription', account)
        }
      }
    } else {
      shouldAddRecommendations = true
    }

    if (Object.values(suggestions).length < 15 || shouldAddRecommendations) {
      const ninaRecommendedHubSubscriptions = await Subscription.query()
        .where('from', process.env.HUB_SUGGESTIONS_PUBLIC_KEY)
        .andWhere('subscriptionType', 'hub')
      
      // Batch fetch all recommended hubs
      const recommendedHubKeys = ninaRecommendedHubSubscriptions.map(sub => sub.to)
      const recommendedHubs = await Hub.query().whereIn('publicKey', recommendedHubKeys)
      
      for (const hub of recommendedHubs) {
        if (Object.values(suggestions).filter(suggestion => suggestion.hub.publicKey === hub.publicKey).length === 0) {
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