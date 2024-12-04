import { ref } from 'objection';
import _  from 'lodash';
import anchor from '@project-serum/anchor';
import axios from 'axios'
import {
  Account,
  Exchange,
  Hub,
  Post,
  Release,
  Subscription,
  Tag,
  Transaction,
  Verification,
  config,
} from '@nina-protocol/nina-db';
import NinaProcessor from '../indexer/processor.js';
import { decode, fetchFromArweave } from '../indexer/utils.js';
import ratelimit from 'koa-ratelimit';
import Knex from 'knex'

// NOTE: originally many endpoints were lacking pagination
// BIG_LIMIT is a temporary solution to allow us to still return all 
// results in applications that haven't implemented pagination yet
const BIG_LIMIT = 5000;
const idList = [
  '13572',
]
const db = Knex(config.development)

export default (router) => {
  router.get('/accounts', async(ctx) => {
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

  router.get('/accounts/sitemap', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/all', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/collected', async (ctx) => {
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



  router.get('/accounts/:publicKeyOrHandle/hubs', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/posts', async (ctx) => {
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
  
  router.get('/accounts/:publicKeyOrHandle/published', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/exchanges', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/revenueShares', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/subscriptions', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/following/:followingPublicKeyOrHandle', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/followers', async (ctx) => {
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


  router.get('/accounts/:publicKeyOrHandle/verifications', async (ctx) => {
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

  router.get('/transactions/feed', async (ctx) => {
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

  router.get('/accounts/:publicKey/feed', async (ctx) => {
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

  router.get('/accounts/:publicKeyOrHandle/following/newReleases', async (ctx) => {
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

  router.get('/accounts/:publicKey/activity', async (ctx) => {
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

  router.get('/accounts/:publicKey/hubSuggestions', async (ctx) => {
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
  
  router.get('/releases', async (ctx) => {
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

  router.get('/releases/sitemap', async (ctx) => {
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

  router.get('/releases/:publicKeyOrSlug', async (ctx) => {
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

  router.get('/releases/:publicKeyOrSlug/posts', async (ctx) => {
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

  router.get('/releases/:publicKey/exchanges', async (ctx) => {
    try {
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='createdAt' } = ctx.query;
      column = formatColumnForJsonFields(column);
      let release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      if (!release) {
        release = await Release.query().findOne({slug: ctx.params.publicKey})
        
        if (!release) {
          throw new Error(`Release not found with identifier: ${ctx.params.publicKey}`)
        }
      }
      const exchanges = await release.$relatedQuery('exchanges')
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
      ctx.status = 404
      ctx.body = {
        message: `Release not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  });

  
  router.get('/releases/:releasePublicKeyOrSlug/collectors/:accountPublicKeyOrSlug', async (ctx) => {
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

  router.get('/releases/:publicKey/collectors', async (ctx) => {
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

  router.get('/releases/:publicKey/hubs', async (ctx) => {
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

  router.get('/releases/:publicKey/revenueShareRecipients', async (ctx) => {
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

  router.get('/hubs', async (ctx) => {
    try {
      let { offset=0, limit=20, sort='desc', column='datetime', query='' } = ctx.query;
      column = formatColumnForJsonFields(column, 'data');
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      for await (let hub of hubs.results) {
        await hub.format();
        hub.type = 'hub'
      }

      ctx.body = {
        hubs: hubs.results,
        total: hubs.total,
        query
      };
    } catch (err) {
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching hubs'
      }
    }
  });

  router.get('/hubs/sitemap', async (ctx) => {
    try {
      const hubs = await Hub
        .query()  
        .select('handle')
        .orderBy('datetime', 'desc')
      ctx.body = {
        slugs: hubs.map(hub => hub.handle),
      };
    } catch(err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching hubs for sitemap'
      }
    }
  });

  router.get('/hubs/:publicKeyOrHandle', async (ctx) => {
    try {
      let hub = await hubForPublicKeyOrHandle(ctx)
      const { hubOnly } = ctx.query;
      await NinaProcessor.init()
      if (!hub) {
        const publicKey = ctx.params.publicKeyOrHandle
        const hubAccount = await NinaProcessor.program.account.hub.fetch(new anchor.web3.PublicKey(publicKey), 'confirmed')
        if (hubAccount) {
          const authorityPublicKey = hubAccount.authority.toBase58()
          const authority = await Account.findOrCreate(authorityPublicKey);
          const uri = decode(hubAccount.uri)
          let data
          try {
            data = await axios.get(uri.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz'))
          } catch (error) {
            data = await axios.get(uri.replace('gateway.irys.xyz', 'arweave.net'))
          }
            hub = await Hub.query().insertGraph({
            publicKey,
            handle: decode(hubAccount.handle),
            data: data.data,
            dataUri: uri,
            datetime: new Date(hubAccount.datetime.toNumber() * 1000).toISOString(),
            updatedAt: new Date(hubAccount.datetime.toNumber() * 1000).toISOString(),
            authorityId: authority.id,            
          });
          NinaProcessor.warmCache(data.data.image);

          const [hubCollaborator] = await anchor.web3.PublicKey.findProgramAddress(
            [
              Buffer.from(anchor.utils.bytes.utf8.encode('nina-hub-collaborator')),
              (new anchor.web3.PublicKey(publicKey)).toBuffer(),
              (new anchor.web3.PublicKey(authorityPublicKey)).toBuffer(),
            ],
            new anchor.web3.PublicKey(NinaProcessor.program.programId)
          )
          await Hub.relatedQuery('collaborators').for(hub.id).relate({
            id: authority.id,
            hubCollaboratorPublicKey: hubCollaborator.toBase58(),
          })
        }
      }

      let releases = await hub.$relatedQuery('releases')
      console.log('total releases', releases)
      if (hubOnly === 'true') {
        await hub.format();
        ctx.body = {
          hub,
          total: releases.length,
        }
        return
      }

      const collaborators = await hub.$relatedQuery('collaborators')
      for (let release of releases) {
        await release.format();
      }

      const posts = await hub.$relatedQuery('posts')

      // if hub is less than five minutes old warm the cache
      if (hub.updatedAt && new Date(hub.updatedAt).getTime() > new Date().getTime() - 300000) {
        NinaProcessor.warmCache(hub.data.image);
      }
      
      for (let collaborator of collaborators) {
        await collaborator.format();
      }

      for await (let post of posts) {
        await post.format();
      }
      await hub.format();

      ctx.body = {
        hub,
        collaborators,  
        releases, 
        posts 
      };
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Hub not found with publicKey: ${ctx.params.publicKeyOrHandle}`
      }
    }
  })

  router.get('/hubs/:publicKeyOrHandle/followers', async (ctx) => {
    try {
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
      let hub = await hubForPublicKeyOrHandle(ctx)
      await NinaProcessor.init()

      const subscriptions = await Subscription.query()
        .where('to', hub.publicKey)
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      const followers = []
      const accounts = await Account.query().whereIn('publicKey', subscriptions.results.map(subscription => subscription.from))
      for await (let account of accounts) {
        await account.format();
        const accountFollowers = await Subscription.query().where('to', account.publicKey).range(0, 0)
        followers.push({
          account,
          followers: Number(accountFollowers.total),
          subscription: subscriptions.results.find(subscription => subscription.from === account.publicKey)
        })
      }

      ctx.body = {
        followers,
        total: subscriptions.total,
      };
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Hub not found with publicKey: ${ctx.params.publicKeyOrHandle}`
      }
    }
  })


  router.get('/hubs/:publicKeyOrHandle/tx/:txid', async (ctx) => {
    try {
      const publicKey = ctx.params.publicKeyOrHandle
      let hub = await hubForPublicKeyOrHandle(ctx)
      const hubAccount = await NinaProcessor.program.account.hub.fetch(new anchor.web3.PublicKey(publicKey), 'confirmed')
      if (hub && hubAccount) {
        const uri = decode(hubAccount.uri)
        let data
        try {
          data = await axios.get(uri.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz'))
        } catch (error) {
          data = await axios.get(uri.replace('gateway.irys.xyz', 'arweave.net'))
        }
        await  Hub.query().patch({
          data: data.data,
          dataUri: uri,
          updatedAt: new Date().toISOString(),
        }).findById(hub.id);
      }
      ctx.body = {
        hub,
      };
    } catch (error) {
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching hub'
      }
    }
  })

  router.get('/hubs/:publicKeyOrHandle/collaborators', async (ctx) => {
    try {
      const { offset=0, limit=BIG_LIMIT } = ctx.query;
      const hub = await hubForPublicKeyOrHandle(ctx)
      const collaborators = await hub.$relatedQuery('collaborators')
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      for await (let account of collaborators.results) {
        await account.format();
      }
      ctx.body = {
        collaborators: collaborators.results,
        total: collaborators.total,
        publicKey: hub.publicKey,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })

  router.get('/hubs/:publicKeyOrHandle/all', async (ctx) => {
    try {
      let { offset=0, limit=20, sort='desc', column='datetime', query='' } = ctx.query;
      const hub = await hubForPublicKeyOrHandle(ctx)
      const releases = await Release
        .query()
        .joinRelated('hubs')
        .where('hubs_join.hubId', hub.id)
        .where('hubs_join.visible', true)
        .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      let posts = await hub.$relatedQuery('posts')
        .orderBy(formatColumnForJsonFields(column, 'data'), sort)
        .where(ref('data:title').castText(), 'ilike', `%${query}%`)

      for await(let post of posts) {
        post.type = 'post'
        await post.format();
      }
  
      for (let release of releases.results) {
        release.type = 'release'
        await release.format()
      }

      const all = [...releases.results, ...posts]
      if (sort === 'desc') {
        all.sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
      } else {
        all.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      }

      ctx.body = { 
        all: all.slice(0, Number(limit)),
        total: releases.total + posts.length,
        publicKey: hub.publicKey,
        query,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })


  router.get('/hubs/:publicKeyOrHandle/releases', async (ctx) => {
    try {
      await NinaProcessor.init()
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='', random='false' } = ctx.query;
      column = formatColumnForJsonFields(column);
      const hub = await hubForPublicKeyOrHandle(ctx)
      let releases
      if (random === 'true') {
        const randomReleases = await Release
          .query()
          .joinRelated('hubs')
          .where('hubs_join.hubId', hub.id)
          .where('hubs_join.visible', true)
          .orderByRaw('random()')
          .limit(limit)

        releases = {
          results: randomReleases,
          total: randomReleases.length
        }
      } else {
        releases = await Release
          .query()
          .joinRelated('hubs')
          .where('hubs_join.hubId', hub.id)
          .where('hubs_join.visible', true)
          .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
          .orderBy(column, sort)
          .range(Number(offset), Number(offset) + Number(limit) - 1);
      }

      const hubContentPublicKeys = []
      for await (let release of releases.results) {
        const [hubContentPublicKey] = await anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")), 
            new anchor.web3.PublicKey(hub.publicKey).toBuffer(),
            new anchor.web3.PublicKey(release.publicKey).toBuffer(),
          ],
          NinaProcessor.program.programId
        )
        hubContentPublicKeys.push(hubContentPublicKey)
      }
      const hubContent = await NinaProcessor.program.account.hubContent.fetchMultiple(hubContentPublicKeys, 'confirmed')
      for await (let release of releases.results) {
        const releaseHubContent = hubContent.filter(hc => hc.child.toBase58() === release.hubReleasePublicKey)[0]
        if (releaseHubContent) {
          release.datetime = new Date(releaseHubContent.datetime.toNumber() * 1000).toISOString()
        }
      }
      
      if (sort === 'desc') {
        releases.results.sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
      } else {
        releases.results.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      }

      for await (let release of releases.results) {
        await release.format()
      }

      ctx.body = { 
        releases: releases.results,
        total: releases.total,
        publicKey: hub.publicKey,
        query,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })

  router.get('/hubs/:publicKeyOrHandle/releases/archived', async (ctx) => {
    try {
      await NinaProcessor.init()
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query = '' } = ctx.query;
      column = formatColumnForJsonFields(column);
      const hub = await hubForPublicKeyOrHandle(ctx)
      let releases
      const archivedReleasesForHub = await Release
        .query()
        .joinRelated('hubs')
        .where('hubs_join.hubId', hub.id)
        .where('hubs_join.visible', false)
        .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      releases = await Release.query()
        .whereIn('id', archivedReleasesForHub.results.map(release => release.id))

      for await (let release of releases) {
        await release.format()
      }
      
      releases = {
        results: releases,
        total: archivedReleasesForHub.total
      }

      const hubContentPublicKeys = []
      for await (let release of releases.results) {
        const [hubContentPublicKey] = await anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode("nina-hub-content")), 
            new anchor.web3.PublicKey(hub.publicKey).toBuffer(),
            new anchor.web3.PublicKey(release.publicKey).toBuffer(),
          ],
          NinaProcessor.program.programId
        )
        hubContentPublicKeys.push(hubContentPublicKey)
      }
      const hubContent = await NinaProcessor.program.account.hubContent.fetchMultiple(hubContentPublicKeys, 'confirmed')
      for await (let release of releases.results) {
        const releaseHubContent = hubContent.filter(hc => hc.child.toBase58() === release.hubReleasePublicKey)[0]
        if (releaseHubContent) {
          release.datetime = new Date(releaseHubContent.datetime.toNumber() * 1000).toISOString()
        }
      }
      
      if (sort === 'desc') {
        releases.results.sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
      } else {
        releases.results.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      }

      ctx.body = { 
        releases: releases.results,
        total: releases.total,
        publicKey: hub.publicKey,
        query,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })


  const secondFloorMiddleware = async (ctx, next) => {
    if (ctx.params.publicKeyOrHandle === 'FjAN2t3Q2URkTfCUupbbDoLPUzi5zCv8APDDj2XUcjoL') {
      try {
        return ratelimit({
          driver: 'memory',
          db: new Map(),
          duration: 600000,
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
              ctx.request.query.api_key === process.env.NINA_API_KEY
            ) {
              return true;
            }
        
            return false;
          },
          max: 200,
          disableHeader: false,
        })(ctx, next)
      } catch (error) {
        console.log('secondFloorMiddleware error', error)
      }
    }
    return next()
  }

  router.get('/hubs/:publicKeyOrHandle/posts', secondFloorMiddleware, async (ctx) => {
    try {
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime', query='' } = ctx.query;
      column = formatColumnForJsonFields(column, 'data');
      const hub = await hubForPublicKeyOrHandle(ctx)
      let posts = await hub.$relatedQuery('posts')
          .where(ref('data:title').castText(), 'ilike', `%${query}%`)
          .orderBy(column, sort)
          .range(Number(offset), Number(offset) + Number(limit) - 1);

      for await (let post of posts.results) {
        await post.format();
      }

      ctx.body = {
        posts: posts.results,
        total: posts.total,
        publicKey: hub.publicKey,
        query,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })

  router.get('/hubs/:publicKeyOrHandle/hubReleases/:hubReleasePublicKey', async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx)
      const release = await Release
        .query()
        .joinRelated('hubs')
        .where('hubs_join.hubId', hub.id)
        .where('hubs_join.hubReleasePublicKey', ctx.params.hubReleasePublicKey)
        .first()
      if (hub && release) {
        const [hubContentPublicKey] = await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode('nina-hub-content')),
            new anchor.web3.PublicKey(hub.publicKey).toBuffer(),
            new anchor.web3.PublicKey(release.publicKey).toBuffer(),
          ],
          NinaProcessor.program.programId
        )
        const hubContent = await NinaProcessor.program.account.hubContent.fetch(hubContentPublicKey, 'confirmed')
        await Hub.relatedQuery('releases').for(hub.id).patch({
          visible: hubContent.visible,
        }).where( {id: release.id });

        ctx.body = {
          release,
          hub,
        }
      } else if (hub && !release) {
        await NinaProcessor.init()
        const hubRelease = await NinaProcessor.program.account.hubRelease.fetch(new anchor.web3.PublicKey(ctx.params.hubReleasePublicKey), 'confirmed')
        if (hubRelease) {
          const releaseRecord = await Release.findOrCreate(hubRelease.release.toBase58())
          const [hubContentPublicKey] = await anchor.web3.PublicKey.findProgramAddress(
            [
              Buffer.from(anchor.utils.bytes.utf8.encode('nina-hub-content')),
              hubRelease.hub.toBuffer(),
              hubRelease.release.toBuffer(),
            ],
            NinaProcessor.program.programId
          )
          const hubContent = await NinaProcessor.program.account.hubContent.fetch(hubContentPublicKey, 'confirmed')
          await Hub.relatedQuery('releases').for(hub.id).relate({
            id: releaseRecord.id,
            hubReleasePublicKey: ctx.params.hubReleasePublicKey,
          });
          if (hubContent.publishedThroughHub) {
            await releaseRecord.$query().patch({hubId: hub.id});
          }
          await hub.format();
          await releaseRecord.format();
          ctx.body = {
            release: releaseRecord,
            hub,
          }
        } else {
          throw ('Hub release not found')
        }
      } else {
        await hub.format();
        await release.format();
        ctx.body = {
          release,
          hub,
        }
      }
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `HubRelease not found with hub: ${ctx.params.publicKeyOrHandle} and HubRelease publicKey: ${ctx.params.hubReleasePublicKey}`
      }
    }      
  })

  router.get('/hubs/:publicKeyOrHandle/collaborators/:hubCollaboratorPublicKey', async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx)
      if (hub) {
        await NinaProcessor.init()
        const hubCollaborator = await lookupCollaborator(ctx.params.hubCollaboratorPublicKey)
        if (hubCollaborator) {
          const collaborator = await Account.findOrCreate(hubCollaborator.collaborator.toBase58())
          const result = await Hub.relatedQuery('collaborators').for(hub.id).relate({
            id: collaborator.id,
            hubCollaboratorPublicKey: ctx.params.hubCollaboratorPublicKey,
          })
          const account = await Hub.relatedQuery('collaborators').for(hub.id).where('accountId', collaborator.id).first();
        } else {
          const collaborator = await Account
            .query()
            .joinRelated('hubs')
            .where('hubs_join.hubId', hub.id)
            .where('hubs_join.hubCollaboratorPublicKey', ctx.params.hubCollaboratorPublicKey)
            .first()          
          await Hub.relatedQuery('collaborators').for(hub.id).unrelate().where('accountId', collaborator.id)
        }
        ctx.body = { success: true}
      }
    } catch (error) {
      ctx.body = { success: true }
    }
  })

  const lookupCollaborator = async (hubCollaboratorPublicKey) => {
    try {
      const hubCollaborator = await NinaProcessor.program.account.hubCollaborator.fetch(new anchor.web3.PublicKey(hubCollaboratorPublicKey), 'confirmed')
      return hubCollaborator
    } catch (error) {
      return undefined
    }
  }

  router.get('/hubs/:publicKeyOrHandle/hubPosts/:hubPostPublicKey', async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx)
      let post = await Post
        .query()
        .joinRelated('hubs')
        .where('hubs_join.hubId', hub.id)
        .where('hubs_join.hubPostPublicKey', ctx.params.hubPostPublicKey)
        .first()
      if (!post) {
        await NinaProcessor.init()
        const hubPostAccount = await NinaProcessor.program.account.hubPost.fetch(new anchor.web3.PublicKey(ctx.params.hubPostPublicKey), 'confirmed')
        const [hubContentPublicKey] = await anchor.web3.PublicKey.findProgramAddress(
          [
            Buffer.from(anchor.utils.bytes.utf8.encode('nina-hub-content')),
            hubPostAccount.hub.toBuffer(),
            hubPostAccount.post.toBuffer(),
          ],
          NinaProcessor.program.programId
        )
        const hubContentAccount = await NinaProcessor.program.account.hubContent.fetch(hubContentPublicKey, 'confirmed')
        const postAccount = await NinaProcessor.program.account.post.fetch(hubPostAccount.post, 'confirmed')
        const uri = decode(postAccount.uri)
        let data
        try {
          data = await axios.get(uri.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz'))
        } catch (error) {
          data = await axios.get(uri.replace('gateway.irys.xyz', 'arweave.net'))
        }
        const publisher = await Account.findOrCreate(postAccount.author.toBase58());
        post = await Post.query().insertGraph({
          publicKey: hubPostAccount.post.toBase58(),
          data: data.data,
          datetime: new Date(postAccount.createdAt.toNumber() * 1000).toISOString(),
          publisherId: publisher.id,
        })
        await Hub.relatedQuery('posts').for(hub.id).relate({
          id: post.id,
          hubPostPublicKey: ctx.params.hubPostPublicKey,
        });
        if (hubContentAccount.publishedThroughHub) {
          await post.$query().patch({hubId: hub.id});
        }
        if (hubPostAccount.referenceContent) {
          const release = await Release.query().findOne({publicKey: hubPostAccount.referenceContent.toBase58()});
          if (release) {
            const relatedRelease = await Post.relatedQuery('releases').for(post.id).where('releaseId', release.id).first();
            if (!relatedRelease) {
              await Post.relatedQuery('releases').for(post.id).relate(release.id);
              console.log('Related Release to Post:', release.publicKey, post.publicKey);
            }
          }
        }
      }
      await hub.format();
      await post.format();
      ctx.body = {
        post,
        hub,
      }
    } catch (err) {
      console.log(err)
      hubPostNotFound(ctx)
    }   
  })

  router.get('/hubs/:publicKeyOrHandle/subscriptions', async (ctx) => {
    try {
      let { offset=0, limit=BIG_LIMIT, sort='desc', column='datetime' } = ctx.query;
      column = formatColumnForJsonFields(column);
      const hub = await hubForPublicKeyOrHandle(ctx)
      const subscriptions = await Subscription.query()
        .where('to', hub.publicKey)
        .where('subscriptionType', 'hub')
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      for await (let subscription of subscriptions.results) {
        await subscription.format();
      }
      ctx.body = { 
        subscriptions: subscriptions.results,
        total: subscriptions.total,
        publicKey: hub.publicKey,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })


  router.get('/posts', async (ctx) => {
    try {
      const { offset=0, limit=20, sort='desc', column='datetime', query=''} = ctx.query;
      const posts = await Post
        .query()
        .where(ref('data:title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
        .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      for await (let post of posts.results) {
        await post.format();
        post.type = 'post'
      }
      ctx.body = {
        posts: posts.results,
        total: posts.total,
        query
      };
    } catch (err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching posts'
      }
    }
  })

  router.get('/posts/sitemap', async (ctx) => {
    try {
      const posts = await Post
        .query()  
        .select(ref('data:slug').castText())
        .orderBy('datetime', 'desc')
      ctx.body = {
        slugs: posts.map(post => post.text),
      };
    } catch(err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching posts for sitemap'
      }
    }
  });

  router.get('/posts/:publicKeyOrSlug', async (ctx) => {
    try {
      await NinaProcessor.init()
      let postAccount
      const { txid } = ctx.query
      let post = await Post.query().findOne({publicKey: ctx.params.publicKeyOrSlug})
      if (!post) {
        post = await Post.query().where(ref('data:slug').castText(), 'like', `%${ctx.params.publicKeyOrSlug}%`).first()
      }
      if (!post) {
        postAccount = await NinaProcessor.program.account.post.fetch(new anchor.web3.PublicKey(ctx.params.publicKeyOrSlug), 'confirmed');
        if (!postAccount) {
          throw ('Post not found')
        }
        let hub
        let hubPublicKey
        if (txid) {
          const tx = await NinaProcessor.provider.connection.getParsedTransaction(txid, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          })
          console.log('tx', tx)
          const accounts = tx.transaction.message.instructions.find(i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID)?.accounts
          hubPublicKey = accounts[1].toBase58()
        }
        if (hubPublicKey) {
          const [hubContentPublicKey] =
          await anchor.web3.PublicKey.findProgramAddress(
            [
              Buffer.from(anchor.utils.bytes.utf8.encode(`nina-hub-content`)),
              new anchor.web3.PublicKey(hubPublicKey).toBuffer(),
              new anchor.web3.PublicKey(ctx.params.publicKeyOrSlug).toBuffer(),
            ],
            NinaProcessor.program.programId,
          )
          const hubContentAccount = await NinaProcessor.program.account.hubContent.fetch(new anchor.web3.PublicKey(hubContentPublicKey), 'confirmed');
          if (hubContentAccount) {
            hub = await Hub.query().findOne({ publicKey: hubContentAccount.hub.toBase58() });
          }
        }
        const data = await fetchFromArweave(decode(postAccount.uri));
        const publisher = await Account.findOrCreate(postAccount.author.toBase58());
        const postData = {
          publicKey: ctx.params.publicKeyOrSlug,
          data: data,
          datetime: new Date(postAccount.createdAt.toNumber() * 1000).toISOString(),
          publisherId: publisher.id,
          version: data.blocks ? '0.0.2' : '0.0.1'
        }
        if (hub) {
          postData.hubId = hub.id
        }
        post = await Post.query().insertGraph(postData)
        if (post.data.heroImage) {
          NinaProcessor.warmCache(post.data.heroImage, 5000);
        }
        if (data.blocks) {
          for await (let block of data.blocks) {
            switch (block.type) {
              case 'image':
                try {
                  NinaProcessor.warmCache(block.data.image, 5000);
                } catch (error) {
                  console.log(error)
                }
                break;

              case 'release':
                for await (let release of block.data) {
                  try {
                    const releaseRecord = await Release.query().findOne({ publicKey: release.publicKey });
                    await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
                  } catch (err) {
                    console.log('error', err)
                  }
                }
                break;

              case 'featuredRelease':
                try {
                  const releaseRecord = await Release.query().findOne({ publicKey: block.data });
                  await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
                } catch (err) {
                  console.log('error', err)
                }
                break
                
              default:
                break
            }
          }
        }
      }
      const publisher = await post.$relatedQuery('publisher')
      await publisher.format();
      const publishedThroughHub = await post.$relatedQuery('publishedThroughHub')
      if (publishedThroughHub) {
        await publishedThroughHub.format();
      }
      await post.format();

      if (post.data.blocks) {
        const releases = []
        for await (let block of post.data.blocks) {
          switch (block.type) {
            case 'release':
              for await (let release of block.data) {
                const releaseRecord = await Release.query().findOne({ publicKey: release });
                if (releaseRecord) {
                  await releaseRecord.format();
                  releases.push(releaseRecord)
                }
              }
              block.data.release = releases
              break;
            case 'featuredRelease':
              const releaseRecord = await Release.query().findOne({ publicKey: block.data });
              if (releaseRecord) {
                await releaseRecord.format();
                block.data = releaseRecord
              }
              break;
            
            case 'hub':
              const hubs = []
              for await (let hub of block.data) {
                const hubRecord = await Hub.query().findOne({ publicKey: hub });
                if (hubRecord) {
                  await hubRecord.format();
                  hubs.push(hubRecord)
                }
              }
              block.data.hubs = hubs
              break;
            default:
              break;
          }
        }
      }

      ctx.body = {
        post,
        publisher,
        publishedThroughHub,
    };
    } catch (err) {
      console.log(err)
      postNotFound(ctx)
    }
  })
  
  router.get('/exchanges', async (ctx) => {
    try {
      let { offset=0, limit=20, sort='desc', column='createdAt' } = ctx.query;
      column = formatColumnForJsonFields(column);
      const exchanges = await Exchange
        .query()
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
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching exchanges'
      }
    }
  })

  router.get('/exchanges/:publicKey', async (ctx) => {
    try {
      await NinaProcessor.init()
      let transaction
      if (ctx.query.transactionId) {
        transaction = await NinaProcessor.provider.connection.getParsedTransaction(ctx.query.transactionId, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        })
        logger(`GET /exchanges/:publicKey ${ctx.query.transactionId}`)
      }
      let exchange = await Exchange.query().findOne({publicKey: ctx.params.publicKey})
      
      if (exchange && transaction) {
        console.log('exchange found', exchange)
        const length = transaction.transaction.message.instructions.length
        const accounts = transaction.transaction.message.instructions[length - 1].accounts
        if (accounts) {
          console.log('accounts.length', accounts.length)
          if (transaction.meta.logMessages.some(log => log.includes('ExchangeCancel'))) {
            console.log('found a cancel')
            const updatedAt = new Date(transaction.blockTime * 1000).toISOString()
            await Exchange.query().patch({cancelled: true, updatedAt}).findById(exchange.id)
          } else if (transaction.meta.logMessages.some(log => log.includes('ExchangeAccept'))) {
            console.log('found an accept')
            const completedByPublicKey = transaction.transaction.message.instructions[length - 1].accounts[0].toBase58()
            const updatedAt = new Date(transaction.blockTime * 1000).toISOString()
            const completedBy = await Account.findOrCreate(completedByPublicKey)
            await Exchange.query().patch({completedById: completedBy.id, updatedAt}).findById(exchange.id)
          }
        } 
      } else if (!exchange && transaction) {     
        console.log('found an init')
        const exchangeAccount = await NinaProcessor.program.account.exchange.fetch(ctx.params.publicKey, 'confirmed') 
        const initializer = await Account.findOrCreate(exchangeAccount.initializer.toBase58());  
        const release = await Release.query().findOne({publicKey: exchangeAccount.release.toBase58()});
        await Exchange.query().insertGraph({
          publicKey: ctx.params.publicKey,
          expectedAmount: exchangeAccount.isSelling ? exchangeAccount.expectedAmount.toNumber()  / 1000000 : 1,
          initializerAmount: exchangeAccount.isSelling ? 1 : exchangeAccount.initializerAmount.toNumber() / 1000000,
          isSale: exchangeAccount.isSelling,
          cancelled: false,
          initializerId: initializer.id,
          releaseId: release.id,
          createdAt: new Date(transaction.blockTime * 1000).toISOString(),
        })
      }
      exchange = await Exchange.query().findOne({publicKey: ctx.params.publicKey})
      if (exchange) {
        await exchange.format();
        ctx.body = { exchange }
      }  
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Exchange not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  });

  router.get('/search/all', async (ctx) => {
    try {
      let { offset=0, limit=2, sort='desc', query='', includePosts='false' } = ctx.query;

      const accounts = await Account.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('handle', 'ilike', `%${query}%`)
        .orderBy('displayName', sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      
      for await (let account of accounts.results) {
        account.type = 'account'
        await account.format();
      }
  
      const releases = await Release.query()
        .where('archived', false)
        .whereNotIn('publisherId', idList)
        .whereIn('id', getReleaseSearchSubQuery(query))
        .orderBy('datetime', sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
  
      for await (let release of releases.results) {
        release.type = 'release'
        await release.format();
      }
  
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orderBy('datetime', sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      
      for await (let hub of hubs.results) {
        hub.type = 'hub'
        await hub.format()
      }

      let posts = []
  
      if (includePosts === 'true') {
        posts = await Post.query()
          .where(ref('data:title').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
          .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))
          .orderBy('datetime', sort)
          .range(Number(offset), Number(offset) + Number(limit) - 1);
  
        for await (let post of posts.results) {
          post.type = 'post'
          await post.format();
        }
      }

      const exactMatch = await Tag.query()
        .where('value', `${query}`)
        .first();

      const tags = await Tag.query()
        .where('value', 'like', `%${query}%`)
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      
      if (exactMatch && !tags.results.find(tag => tag.id === exactMatch.id)) {
        tags.results.unshift(exactMatch)
      }

      for await (let tag of tags.results) {
        tag.count = await Tag.relatedQuery('releases').for(tag.id).resultSize();
        tag.type = 'tag'
        await tag.format();
      }

      tags.results.sort((a, b) => b.count - a.count)
      const response = {
        accounts,
        releases,
        hubs,
        tags,
      }
      if (includePosts === 'true') {
        response.posts = posts
      }
      ctx.body = response;
    } catch (error) {
      console.log(error)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching search results'
      }
    }
});

  router.post('/search/v2', async (ctx) => {
    try { 
      let { offset=0, limit=20, sort='desc', query='' } = ctx.request.body;
      console.log('query', ctx.request.body)
      const accounts = await Account.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('handle', 'ilike', `%${query}%`)
      
      for await (let account of accounts) {
        account.type = 'account'
        await account.format()
      }
      const releases = await Release.query()
        .where('archived', false)
        .whereNotIn('publisherId', idList)
        .whereIn('id', getReleaseSearchSubQuery(query))
      
      const formattedReleasesResponse = []
      for await (let release of releases) {
        release.type = 'release'
        await release.format();
        formattedReleasesResponse.push(release)
      }
      
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
      
      for await (let hub of hubs) {
        hub.type = 'hub'
        await hub.format()
      }
      
      const posts = await Post.query()
        .where(ref('data:title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
        .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))

      for await (let post of posts) {
        post.type = 'post'
        await post.format();
      }

      const all = [...formattedReleasesResponse, ...hubs, ...posts, ...accounts]
      if (sort === 'desc') {
        all.sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
      } else {
        all.sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      }

      ctx.body = {
        all: all.slice(Number(offset), Number(offset) + Number(limit)),
        total: all.length,
        query,
      }
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: err
      }
    }
  })

  router.post('/search', async (ctx) => {
    try { 
      const { query } = ctx.request.body;

      //TODO: Remove this once frontend is expecting Accounts instead of Artists
      const releasesByArtist = await Release.query()
        .where(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)

      const formattedArtistsResponse = []
      for await (let release of releasesByArtist) {
        const account = await release.$relatedQuery('publisher')
        const releases = await Release.query().where('publisherId', account.id)
        const publishesAs = releases.map(release => release.metadata.properties.artist).filter((value, index, self) => self.indexOf(value) === index)
        await account.format()
        formattedArtistsResponse.push({
          name: release.metadata.properties.artist,
          account,
          publishesAs
        })
      }

      const verifications = await Verification.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('value', 'ilike', `%${query}%`)
      
        for await (let verification of verifications) {
        await verification.format()
      }

      const releases = await Release.query()
        .where(ref('metadata:description').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:symbol').castText(), 'ilike', `%${query}%`)
        .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))

      const formattedReleasesResponse = []
      for await (let release of releases) {
        const publishedThroughHub = await release.$relatedQuery('publishedThroughHub')

        if (publishedThroughHub) {
          // Don't show releases that have been archived from their originating Hub
          // TODO: This is a temporary solution. To Double posts - should be removed once we have mutability  
          const isVisible = await Release
            .query()
            .joinRelated('hubs')
            .where('hubs_join.hubId', publishedThroughHub.id)
            .where('hubs_join.releaseId', release.id)
            .where('hubs_join.visible', true)
            .first()
  
          if (isVisible) {  
            formattedReleasesResponse.push({
              artist: release.metadata.properties.artist,
              title: release.metadata.properties.title,
              image: release.metadata.image,
              publicKey: release.publicKey
            })
          }
        } else {
          formattedReleasesResponse.push({
            artist: release.metadata.properties.artist,
            title: release.metadata.properties.title,
            image: release.metadata.image,
            publicKey: release.publicKey
          })
        }
      }
  
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
      
      const formattedHubsResponse = []
      for await (let hub of hubs) {
        formattedHubsResponse.push({
          displayName: hub.data.displayName,
          handle: hub.handle,
          publicKey: hub.publicKey,
          image: hub.data.image,
        })
      }

      ctx.body = {
        accounts: _.uniqBy(verifications, x => x.account),
        artists: _.uniqBy(formattedArtistsResponse, x => x.account.publicKey),
        releases: _.uniqBy(formattedReleasesResponse, x => x.publicKey),
        hubs: _.uniqBy(formattedHubsResponse, x => x.publicKey),
      }
    } catch (err) {
      ctx.status = 404
      ctx.body = {
        message: err
      }
    }
  })

  router.post('/suggestions', async (ctx) => {
    try { 

      const { query } = ctx.request.body;

      //TODO: Remove this once frontend is expecting Accounts instead of Artists
      const releasesByArtist = await Release.query()
        .where(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)
        .limit(8)

      const formattedArtistsResponse = []
      for await (let release of releasesByArtist) {
        const account = await release.$relatedQuery('publisher')
        const releases = await Release.query().where('publisherId', account.id)
        const publishesAs = releases.map(release => release.metadata.properties.artist).filter((value, index, self) => self.indexOf(value) === index)
        await account.format()
        formattedArtistsResponse.push({
          name: release.metadata.properties.artist,
          account,
          publishesAs
        })
      }

      const verifications = await Verification.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('value', 'ilike', `%${query}%`)
        .limit(8)

        for await (let verification of verifications) {
        await verification.format()
      }
    
      const releases = await Release.query()
        .where(ref('metadata:description').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:symbol').castText(), 'ilike', `%${query}%`)
        .limit(8)

      const formattedReleasesResponse = []
      for await (let release of releases) {
        const publishedThroughHub = await release.$relatedQuery('publishedThroughHub')

        if (publishedThroughHub) {
          // Don't show releases that have been archived from their originating Hub
          // TODO: This is a temporary solution. To Double posts - should be removed once we have mutability  
          const isVisible = await Release
            .query()
            .joinRelated('hubs')
            .where('hubs_join.hubId', publishedThroughHub.id)
            .where('hubs_join.releaseId', release.id)
            .where('hubs_join.visible', true)
            .first()
  
          if (isVisible) {  
            formattedReleasesResponse.push({
              artist: release.metadata.properties.artist,
              title: release.metadata.properties.title,
              image: release.metadata.image,
              publicKey: release.publicKey
            })
          }
        } else {
          formattedReleasesResponse.push({
            artist: release.metadata.properties.artist,
            title: release.metadata.properties.title,
            image: release.metadata.image,
            publicKey: release.publicKey
          })
        }
      }  
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
        .limit(8)
      
      const formattedHubsResponse = []
      for await (let hub of hubs) {
        formattedHubsResponse.push({
          displayName: hub.data.displayName,
          handle: hub.handle,
          publicKey: hub.publicKey,
          image: hub.data.image,
        })
      }

      ctx.body = {
        accounts: _.uniqBy(verifications, x => x.account),
        artists: _.uniqBy(formattedArtistsResponse, x => x.account.publicKey),
        releases: _.uniqBy(formattedReleasesResponse, x => x.publicKey),
        hubs: _.uniqBy(formattedHubsResponse, x => x.publicKey),
      }
    } catch (err) {
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

  const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

  const verficationRequest = async (publicKey) => {
    try {
      let verification = await NinaProcessor.processVerification(new anchor.web3.PublicKey(publicKey))
      return verification
    } catch (err) {
      return undefined
    }
  }

  const getVerification = async (publicKey) => {
    try {
      let i = 0;
      let verification
      while (!verification && i < 60) {
        verification = await verficationRequest(publicKey)
        i++;
        await sleep(500)
      }
      return verification
    } catch (err) {
      console.warn(err)
    }
  }

  router.get('/verifications/:publicKey', async (ctx) => {
    try {
      let verification = await Verification.query().findOne({publicKey: ctx.params.publicKey})
      if (!verification) {
        await NinaProcessor.init();
        verification  = await getVerification(ctx.params.publicKey)
      }
      await verification.format()
      ctx.body = {
        verification,
      }
    } catch (error) {
      console.warn(error)
      ctx.status = 400
      ctx.body = {
        success: false,
      }
    }
  })

  router.get('/verifications/:publicKey/unregister', async (ctx) => {
    try {
      console.log('/verifications/:publicKey/unregister publicKey', ctx.params.publicKey)
      let verification = await Verification.query().findOne({publicKey: ctx.params.publicKey})
      console.log('verification', verification)
      if (verification) {
        let confirmedDeleted = false
        await NinaProcessor.init();
        let i = 0;
        while (!confirmedDeleted && i < 60) {
          console.log('publicKey', ctx.params.publicKey)
          console.log('i', i)
          console.log('confirmedDeleted', confirmedDeleted)
          i++;
          let ninaNameIdRegistry = await NinaProcessor.provider.connection.getAccountInfo(
            new anchor.web3.PublicKey(ctx.params.publicKey)
          );
          if (!ninaNameIdRegistry) {
            await verification.$query().delete()
            confirmedDeleted = true
            console.log('successfully deleted verification', ctx.params.publicKey)
          } else {
            await sleep(1500)
          }  
        }  
      }
      ctx.body = {
        success: true,
      }
    } catch (error) {
      console.warn(error)
      ctx.status = 400
      ctx.body = {
        success: false,
      }

    }
  })

  router.get('/tags', async (ctx) => {
    try {
      let { offset=0, limit=20, sort='desc', query='', type="fuzzy" } = ctx.query;
      
      let queryString
      switch (type) {
        case "fuzzy":
          queryString = `%${query}%`
          break;
        case "exact":
          queryString = query
          break;
        case "autocomplete":
          queryString = `${query}%`
          break;
        default:
          queryString = `%${query}%`
          break;
      }

      const tags = await db.raw(`
        SELECT tags.*, COUNT(tags_releases."tagId") as count
        FROM tags
        JOIN tags_releases ON tags.id = tags_releases."tagId"
        WHERE tags.value ILIKE '${queryString}%'
        GROUP BY tags.id
        ORDER BY count ${sort}
        LIMIT ${limit}
        OFFSET ${offset}
      `)
        
      const total = await Tag.query().where('value', 'ilike', `%${query}%`).resultSize()
    
      for await (let tag of tags.rows) {
        tag.count = Number(tag.count)
        delete tag.id
      }
      ctx.body = {
        tags: {
          results: tags.rows,
          total,
        }
      }
    } catch (error) {
      console.warn(error)
      ctx.status = 400
      ctx.body = {
        success: false,
      }
    }
  })

  router.get('/tags/:value', async (ctx) => {
    try {
      let { offset=0, limit=20, sort='desc', column='datetime' } = ctx.query;
      const tag = await Tag.query().findOne({value: ctx.params.value.toLowerCase()})
      const releases = await Tag.relatedQuery('releases').for(tag.id)
        .orderBy(column, sort)
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      for await (let release of releases.results) {
        await release.format();
      }
      ctx.body = {
        releases: releases.results,
        total: releases.total,
      }
    } catch (error) {
      console.warn(error)
      ctx.status = 400
      ctx.body = {
        success: false,
      }
    }
  })
}

const hubPostNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `HubPost not found with hub: ${ctx.params.publicKeyOrHandle} and HubPost publicKey: ${ctx.params.hubPostPublicKey}`
  }
}

const accountNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    success: false,
    message: `Account not found with publicKey: ${ctx.params.publicKey}`
  }
}

const postNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `Post not found with publicKey: ${ctx.params.publicKey}`
  }
}

const hubNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `Hub not found with publicKey: ${ctx.params.publicKey}`
  }
}

const hubForPublicKeyOrHandle = async (ctx) => {
  let hub = await Hub.query().findOne({publicKey: ctx.params.publicKeyOrHandle})
  if (!hub) {
    hub = await Hub.query().findOne({handle: ctx.params.publicKeyOrHandle})
  }
  return hub
}

const formatColumnForJsonFields = (column, fieldName='metadata') => {
  if (column.includes(':')) {
    column = fieldName + ':' + column.split(':')[1]
    column = ref(column).castText()
  }
  return column
}

const getPublishedThroughHubSubQuery = (query) => {
  const publishedThroughHubSubQuery = Hub.query()
    .select('id')
    .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
    .orWhere('handle', 'ilike', `%${query}%`)

  return publishedThroughHubSubQuery
}

const getPublisherSubQuery = (query) => {
  const publisherSubQuery = Account.query()
    .select('id')
    .where('displayName', 'ilike', `%${query}%`)
    .orWhere('handle', 'ilike', `%${query}%`)

  return publisherSubQuery
}

const getReleaseSearchSubQuery = (query) => {
  const releases = Release.query()
    .select('id')
    .where(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)
    .orWhere(db.raw(`SIMILARITY(metadata->\'properties\'->>\'title\', '${query}') > 0.3`))
    .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
    .orWhere(ref('metadata:properties.tags').castText(), 'ilike', `%${query}%`)
    .orWhere(ref('metadata:symbol').castText(), 'ilike', `%${query}%`)
    .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))
    .orWhereIn('publisherId', getPublisherSubQuery(query))

    return releases
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