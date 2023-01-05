const { ref } = require('objection');
const _ = require('lodash');
const anchor = require('@project-serum/anchor');
const axios = require('axios')
const Account = require('../indexer/db/models/Account');
const Exchange = require('../indexer/db/models/Exchange');
const Hub = require('../indexer/db/models/Hub');
const Post = require('../indexer/db/models/Post');
const Release = require('../indexer/db/models/Release');
const NinaProcessor = require('../indexer/processor');
const { decode } = require('../indexer/utils');
const Subscription = require('../indexer/db/models/Subscription');
const Transaction = require('../indexer/db/models/Transaction');
const Verification = require('../indexer/db/models/Verification');

const getVisibleReleases = async (published) => {
  const releases = []
  for await (let release of published) {
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
        await release.format();      
        releases.push(release)      
      }
    } else {
      await release.format();
      releases.push(release)
    }
  }
  return releases
}

module.exports = (router) => {
  router.get('/accounts', async(ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const total = await Account.query().count();
      const accounts = await Account.query().orderBy('publicKey', sort).limit(limit).offset(offset);
      for await (let account of accounts) {
        await account.format();
      }
      ctx.body = {
        accounts,
        total: total.count,
      };

    } catch (err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching accounts'
      }

    }
  })

  router.get('/accounts/:publicKey', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      if (!account) {
        accountNotFound(ctx);
        return;
      }
      const collected = await account.$relatedQuery('collected')
      for await (let release of collected) {
        await release.format();
      }

      let published = await account.$relatedQuery('published')
      published = await getVisibleReleases(published)

      const hubs = await account.$relatedQuery('hubs')
      for await (let hub of hubs) {
        await hub.format();
      }
      const posts = await account.$relatedQuery('posts')
      for await (let post of posts) {
        await post.format();
      }
      const exchanges = []
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

      let revenueShares = await account.$relatedQuery('revenueShares')
      revenueShares = await getVisibleReleases(revenueShares)

      const subscriptions = await Subscription.query()
        .where('from', account.publicKey)
        .orWhere('to', account.publicKey)
      
      for await (let subscription of subscriptions) {
        await subscription.format();
      }

      const verifications = await account.$relatedQuery('verifications').where('active', true)
      for await (let verification of verifications) {
        await verification.format();
      }

      ctx.body = { collected, published, hubs, posts, exchanges, revenueShares, subscriptions, verifications };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/collected', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      const { txId } = ctx.query;
      if (txId) {
        await NinaProcessor.init();
        const tx = await NinaProcessor.provider.connection.getParsedTransaction(txId, 'confirmed')
        
        if (tx) {
          const length = tx.transaction.message.instructions.length
          const accounts = tx.transaction.message.instructions[length - 1].accounts
          if (tx.meta.logMessages.some(log => log.includes('ReleasePurchaseViaHub'))) {
            tx.type = 'ReleasePurchaseViaHub'
            releasePublicKey = accounts[2].toBase58()
            accountPublicKey = accounts[0].toBase58()
            hubPublicKey = accounts[8].toBase58()
            await NinaProcessor.addCollectorForRelease(releasePublicKey, accountPublicKey)
          } else if (tx.meta.logMessages.some(log => log.includes('ReleasePurchase'))) {
            tx.type = 'ReleasePurchase'
            releasePublicKey = accounts[2].toBase58()
            accountPublicKey = accounts[0].toBase58()
            await NinaProcessor.addCollectorForRelease(releasePublicKey, accountPublicKey)
          }
        }
      }
      
      const collected = await account.$relatedQuery('collected')
      for await (let release of collected) {
        await release.format();
      }
      ctx.body = { collected };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });


  router.get('/accounts/:publicKey/hubs', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      const hubs = await account.$relatedQuery('hubs')
      for await (let hub of hubs) {
        await hub.format();
      }
      ctx.body = { hubs };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/posts', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      const posts = await account.$relatedQuery('posts')
      for await (let post of posts) {
        await post.format();
      }
      ctx.body = { posts };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });
  
  router.get('/accounts/:publicKey/published', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      let published = await account.$relatedQuery('published')
      published = await getVisibleReleases(published)

      ctx.body = { published };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/exchanges', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      const exchanges = []
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
      ctx.body = { exchanges };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/revenueShares', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      let revenueShares = await account.$relatedQuery('revenueShares')
      revenueShares = await getVisibleReleases(revenueShares)

      ctx.body = { revenueShares };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/subscriptions', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });

      const subscriptions = await Subscription.query()
        .where('from', account.publicKey)
        .orWhere('to', account.publicKey)
      
      for await (let subscription of subscriptions) {
        await subscription.format();
      }

      ctx.body = { subscriptions };
    } catch (err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching subscriptions'
      }
    }
  });

  router.get('/accounts/:publicKey/verifications', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
      const verifications = await account.$relatedQuery('verifications').where('active', true)
      for await (let verification of verifications) {
        await verification.format();
      }
      ctx.body = { verifications };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/feed', async (ctx) => {
    try {
      const { limit=50, offset=0 } = ctx.query;
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
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

      const transactions = await Transaction.query()
        .whereIn('hubId', hubIds)
        .orWhereIn('toHubId', hubIds)
        .orWhereIn('authorityId', accountIds)
        .orWhereIn('toAccountId', accountIds)
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
      ctx.status = 404
      ctx.body = {
        message: err
      }
    }
  })

  router.get('/accounts/:publicKey/activity', async (ctx) => {
    try {
      const { limit=50, offset=0 } = ctx.query;
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
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
      const { offset=0, limit=20, sort='desc' } = ctx.query;
      const total = await Release.query().count();
      let releases = await Release.query().orderBy('datetime', sort).limit(limit).offset(offset);
      releases = await getVisibleReleases(releases)

      ctx.body = {
        releases,
        total: total.count,
      };
    } catch(err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching releases'
      }
    }
  });

  router.get('/releases/:publicKey', async (ctx) => {
    try {
      let release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      if (!release) {
        release = await Release.findOrCreate(ctx.params.publicKey,)
      }  
      await release.format();
      ctx.body = {
        release,
      }
  } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Release not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  });

  router.get('/releases/:publicKey/exchanges', async (ctx) => {
    try {
      const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      const exchanges = await release.$relatedQuery('exchanges')
      for await (let exchange of exchanges) {
        await exchange.format();
      }

      ctx.body = { exchanges };
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Release not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  });

  router.get('/releases/:publicKey/collectors', async (ctx) => {
    try {
      const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      const collectors = await release.$relatedQuery('collectors')
      for await (let account of collectors) {
        if (ctx.request.query.withCollection) {
          const collectedReleases = await account.$relatedQuery('collected')
          const collectedPublicKeys = collectedReleases.map(release => release.publicKey)
          account.collection = collectedPublicKeys
        }
        await account.format();
      }
      ctx.body = { collectors };
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
    const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      const hubs = await release.$relatedQuery('hubs')
      for await (let hub of hubs) {
        await hub.format();
      }
      ctx.body = { hubs };
    } catch (error) {
      console.log(error)
      ctx.status = 404
      ctx.body = {
        message: `Release not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  })

  router.get('/releases/:publicKey/revenueShareRecipients', async (ctx) => {
    try {
      const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      const revenueShareRecipients = await release.$relatedQuery('revenueShareRecipients')
      for await (let account of revenueShareRecipients) {
        await account.format();
      }
      ctx.body = { revenueShareRecipients };
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
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const total = await Hub.query().count();
      const hubs = await Hub.query()
        .whereExists(Hub.relatedQuery('releases'))
        .orWhereExists(Hub.relatedQuery('posts'))
        .orderBy('datetime', sort)
        .limit(limit)
        .offset(offset);
      for await (let hub of hubs) {
        await hub.format();
      }
      ctx.body = {
        hubs,
        total: total.count
      };
    } catch (err) {
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching hubs'
      }
    }
  });
  
  router.get('/hubs/:publicKeyOrHandle', async (ctx) => {
    try {
      let hub = await hubForPublicKeyOrHandle(ctx)
      await NinaProcessor.init()
      if (!hub) {
        const publicKey = ctx.params.publicKeyOrHandle
        const hubAccount = await NinaProcessor.program.account.hub.fetch(new anchor.web3.PublicKey(publicKey), 'confirmed')
        if (hubAccount) {
          const authorityPublicKey = hubAccount.authority.toBase58()
          const authority = await Account.findOrCreate(authorityPublicKey);
          const uri = decode(hubAccount.uri)
          const data = await axios.get(uri)
          hub = await Hub.query().insertGraph({
            publicKey,
            handle: decode(hubAccount.handle),
            data: data.data,
            dataUri: uri,
            datetime: new Date(hubAccount.datetime.toNumber() * 1000).toISOString(),
            authorityId: authority.id,
          });
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

      const collaborators = await hub.$relatedQuery('collaborators')
      let releases = await hub.$relatedQuery('releases')

      const posts = await hub.$relatedQuery('posts')

      await hub.format();

      for (let collaborator of collaborators) {
        await collaborator.format();
      }

      releases = await getVisibleReleases(releases, true)

      for await (let post of posts) {
        await post.format();
      }

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

  router.get('/hubs/:publicKeyOrHandle/tx/:txid', async (ctx) => {
    try {
      const publicKey = ctx.params.publicKeyOrHandle
      let hub = await hubForPublicKeyOrHandle(ctx)
      const hubAccount = await NinaProcessor.program.account.hub.fetch(new anchor.web3.PublicKey(publicKey), 'confirmed')
      if (hub && hubAccount) {
        const uri = decode(hubAccount.uri)
        const data = await axios.get(uri)
        await  Hub.query().patch({
          data: data.data,
          dataUri: uri,
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
      const hub = await hubForPublicKeyOrHandle(ctx)
      const collaborators = await hub.$relatedQuery('collaborators')
      for await (let account of collaborators) {
        await account.format();
      }
      ctx.body = {
        collaborators,
        publicKey: hub.publicKey,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })

  router.get('/hubs/:publicKeyOrHandle/releases', async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx)
      let releases = await hub.$relatedQuery('releases')
      releases = await getVisibleReleases(releases)

      ctx.body = { 
        releases,
        publicKey: hub.publicKey,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })

  router.get('/hubs/:publicKeyOrHandle/posts', async (ctx) => {
    try {
      const hub = await hubForPublicKeyOrHandle(ctx)
      const posts = await hub.$relatedQuery('posts')
      for await (let post of posts) {
        await post.format();
      }
      ctx.body = {
        posts,
        publicKey: hub.publicKey,
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
      if (!release) {
        await NinaProcessor.init()
        const hubRelease = await NinaProcessor.program.account.hubRelease.fetch(new anchor.web3.PublicKey(ctx.params.hubReleasePublicKey), 'confirmed')
        if (hubRelease) {
          const releaseRecord = await Release.findOrCreate(hubRelease.release.toBase58())
      
          let hub = await hubForPublicKeyOrHandle(ctx)
          if (hub) {      
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
        const data = await axios.get(uri)
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
      const hub = await hubForPublicKeyOrHandle(ctx)

      const subscriptions = await Subscription.query()
        .where('subscriptions.to', hub.publicKey)
        .where('subscriptions.subscriptionType', 'hub')

      for await (let subscription of subscriptions) {
        await subscription.format();
      }
      ctx.body = { 
        subscriptions,
        publicKey: hub.publicKey,
      };
    } catch (err) {
      console.log(err)
      hubNotFound(ctx)
    }
  })


  router.get('/posts', async (ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const total = await Post.query().count();
      const posts = await Post.query().orderBy('datetime', sort).limit(limit).offset(offset);
      for await (let post of posts) {
        await post.format();
      }
      ctx.body = {
        posts,
        total: total.count,
      };
    } catch (err) {
      console.log(err)
      ctx.status = 400
      ctx.body = {
        message: 'Error fetching posts'
      }
    }
  })

  router.get('/posts/:publicKey', async (ctx) => {
    try {
      const post = await Post.query().findOne({publicKey: ctx.params.publicKey})

      const publisher = await post.$relatedQuery('publisher')
      await publisher.format();
      
      const publishedThroughHub = await post.$relatedQuery('publishedThroughHub')
      await publishedThroughHub.format();

      await post.format();

      ctx.body = {
        post,
        publisher,
        publishedThroughHub
    };
    } catch (err) {
      console.log(err)
      postNotFound(ctx)
    }
  })
  
  router.get('/exchanges', async (ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const total = await Exchange.query().count();
      const exchanges = await Exchange.query().orderBy('createdAt', sort).limit(limit).offset(offset);
      for await (let exchange of exchanges) {
        await exchange.format();
      }
      ctx.body = {
        exchanges,
        total: total.count,
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
    console.log('/exchanges/:publicKey', ctx.params.publicKey)
    try {
      await NinaProcessor.init()
      let transaction
      if (ctx.query.transactionId) {
        transaction = await NinaProcessor.provider.connection.getParsedTransaction(ctx.query.transactionId, 'confirmed')
        console.log('transaction', transaction)
      }
      let exchange = await Exchange.query().findOne({publicKey: ctx.params.publicKey})
      
      if (exchange && transaction) {
        console.log('exchange found', exchange)
        const length = transaction.transaction.message.instructions.length
        const accounts = transaction.transaction.message.instructions[length - 1].accounts
        if (accounts) {
          console.log('accounts.length', accounts.length)
          if (accounts.length === 6) {
            console.log('found a cancel')
            const updatedAt = new Date(transaction.blockTime * 1000).toISOString()
            await Exchange.query().patch({cancelled: true, updatedAt}).findById(exchange.id)
          } else if (accounts.length === 16) {
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

  router.get('/subscriptions/:publicKey', async (ctx) => {
    try {
      await NinaProcessor.init();
      let transaction
      if (ctx.query.transactionId) {
        transaction =
          await NinaProcessor.provider.connection.getParsedTransaction(
            ctx.query.transactionId,
            "confirmed"
          );
      }

      let subscription = await Subscription.query().findOne({publicKey: ctx.params.publicKey})
      
      if (!subscription && !transaction) {
        await NinaProcessor.init()
        const subscriptionAccount = await NinaProcessor.program.account.subscription.fetch(ctx.params.publicKey, 'confirmed')
        if (subscriptionAccount) {
          //CREATE ENTRY
          await Account.findOrCreate(subscriptionAccount.from.toBase58());
          subscription = await Subscription.findOrCreate({
            publicKey: ctx.params.publicKey,
            from: subscriptionAccount.from.toBase58(),
            to: subscriptionAccount.to.toBase58(),
            datetime: new Date(subscriptionAccount.datetime.toNumber() * 1000).toISOString(),
            subscriptionType: Object.keys(subscriptionAccount.subscriptionType)[0],
          })
        } else {
          throw("Subscription not found")
        }
      } 
      
      if (subscription && transaction) {
        //DELETE ENTRY
        const isUnsubscribe = transaction.meta.logMessages.some(log => log.includes('SubscriptionUnsubscribe'))
        if (isUnsubscribe) {
          await Subscription.query().delete().where('publicKey', subscription.publicKey)
        }
      }
      await subscription.format();
      ctx.body = {
        subscription,
      }
    } catch (err) {
      console.log(err)
      ctx.status = 404
      ctx.body = {
        message: `Subscription not found with publicKey: ${ctx.params.publicKey}`
      }
    }
  });

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

  const sleep = () => new Promise(resolve => setTimeout(resolve, 2000))

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
      while (!verification && i < 30) {
        verification = await verficationRequest(publicKey)
        i++;
        await sleep()
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