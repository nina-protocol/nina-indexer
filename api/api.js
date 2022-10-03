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

module.exports = (router) => {
  router.get('/accounts', async(ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const accounts = await Account.query().orderBy('publicKey', sort).range(offset, offset + limit);
      for await (let account of accounts.results) {
        await account.format();
      }
      ctx.body = {
        accounts: accounts.results,
        total: accounts.total,
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
      const collected = await account.$relatedQuery('collected')
      for await (let release of collected) {
        await release.format();
      }
      const published = await account.$relatedQuery('published')
      for await (let release of published) {
        await release.format();
      }
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
      const revenueShares = []
      const releases = await account.$relatedQuery('revenueShares')
      for await (let release of releases) {
        await release.format();
        revenueShares.push(release)
      }
      ctx.body = { collected, published, hubs, posts, exchanges, revenueShares };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/accounts/:publicKey/collected', async (ctx) => {
    try {
      const account = await Account.query().findOne({ publicKey: ctx.params.publicKey });
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
      const published = await account.$relatedQuery('published')
      for await (let release of published) {
        await release.format();
      }
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
      const revenueShares = []
      const releases = await account.$relatedQuery('revenueShares')
      
      for await (let release of releases) {
        await release.format();
        revenueShares.push(release)
      }

      ctx.body = { revenueShares };
    } catch (err) {
      console.log(err)
      accountNotFound(ctx)
    }
  });

  router.get('/releases', async (ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const releases = await Release.query().orderBy('datetime', sort).range(offset, offset + limit);
      for await (let release of releases.results) {
        await release.format();
      }
      ctx.body = {
        releases: releases.results,
        total: releases.total,
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
        await NinaProcessor.init()
        const releaseAccount = await NinaProcessor.program.account.release.fetch(new anchor.web3.PublicKey(ctx.params.publicKey), 'confirmed')
        if (releaseAccount) {
          const metadataAccount = await NinaProcessor.metaplex.nfts().findByMint(releaseAccount.releaseMint, {commitment: "confirmed"}).run();
        
          let publisher = await Account.findOrCreate(releaseAccount.authority.toBase58());
        
          release = await Release.findOrCreate({
            publicKey: ctx.params.publicKey,
            mint: releaseAccount.releaseMint.toBase58(),
            metadata: metadataAccount.json,
            datetime: new Date(releaseAccount.releaseDatetime.toNumber() * 1000).toISOString(),
            publisherId: publisher.id,
          })
          await Release.processRevenueShares(releaseAccount, release);
        } else {
          throw("Release not found")
        }
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
      const hubs = await Hub.query()
        .whereExists(Hub.relatedQuery('releases'))
        .orWhereExists(Hub.relatedQuery('posts'))
        .orderBy('datetime', sort)
        .range(offset, offset + limit)
      for await (let hub of hubs.results) {
        await hub.format();
      }
      ctx.body = {
        hubs: hubs.results,
        total: hubs.total
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
      if (!hub) {
        const publicKey = ctx.params.publicKeyOrHandle
        await NinaProcessor.init()
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
      const releases = await hub.$relatedQuery('releases')
      const posts = await hub.$relatedQuery('posts')

      await hub.format();

      for (let collaborator of collaborators) {
        collaborator.format();
      }

      for await (let release of releases) {
        await release.format();
      }

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
      const releases = await hub.$relatedQuery('releases')
      for await (let release of releases) {
        await release.format();
      }
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
          const release = await NinaProcessor.program.account.release.fetch(hubRelease.release, 'confirmed')
          const metadataAccount = await NinaProcessor.metaplex.nfts().findByMint(release.releaseMint, {commitment: "confirmed"}).run();
      
          let publisher = await Account.findOrCreate(release.authority.toBase58());
        
          const releaseRecord = await Release.findOrCreate({
            publicKey: hubRelease.release.toBase58(),
            mint: release.releaseMint.toBase58(),
            metadata: metadataAccount.json,
            datetime: new Date(release.releaseDatetime.toNumber() * 1000).toISOString(),
            publisherId: publisher.id,
          })
          await Release.processRevenueShares(release, releaseRecord);
      
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

  router.get('/posts', async (ctx) => {
    try {
      const { offset=0, limit=20, sort='desc'} = ctx.query;
      const posts = await Post.query().orderBy('datetime', sort).range(offset, offset + limit);
      for await (let post of posts.results) {
        await post.format();
      }
      ctx.body = {
        posts: posts.results,
        total: posts.total,
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
      const exchanges = await Exchange.query().orderBy('createdAt', sort).range(offset, offset + limit);
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

      const releasesByArtist = await Release.query()
        .where(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`)

      const formattedArtistsResponse = []
      for await (let release of releasesByArtist) {
        const account = await release.$relatedQuery('publisher').select('publicKey')
        formattedArtistsResponse.push({
          name: release.metadata.properties.artist,
          publicKey: account.publicKey
        })
      }

      const releases = await Release.query()
        .where(ref('metadata:description').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:symbol').castText(), 'ilike', `%${query}%`)

      const formattedReleasesResponse = []
      for await (let release of releases) {
        formattedReleasesResponse.push({
          artist: release.metadata.properties.artist,
          title: release.metadata.properties.title,
          image: release.metadata.image,
          publicKey: release.publicKey
        })
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
        artists: _.uniqBy(formattedArtistsResponse, x => x.publicKey),
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

      const releasesByArtist = await Release.query()
        .where(ref('metadata:properties.artist').castText(), 'ilike', `%${query}%`).limit(8)

      const formattedArtistsResponse = []
      for await (let release of releasesByArtist) {
        const account = await release.$relatedQuery('publisher').select('publicKey')
        formattedArtistsResponse.push({
          name: release.metadata.properties.artist,
          publicKey: account.publicKey
        })
      }

      const releases = await Release.query()
        .where(ref('metadata:description').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:symbol').castText(), 'ilike', `%${query}%`).limit(8)

      const formattedReleasesResponse = []
      for await (let release of releases) {
        formattedReleasesResponse.push({
          artist: release.metadata.properties.artist,
          title: release.metadata.properties.title,
          image: release.metadata.image,
          publicKey: release.publicKey
        })
      }
  
      const hubs = await Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`).limit(8)
      
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
        artists: _.uniqBy(formattedArtistsResponse, x => x.publicKey),
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

const hubForPublicKeyOrHandle = async (ctx) => {
  let hub = await Hub.query().findOne({publicKey: ctx.params.publicKeyOrHandle})
  if (!hub) {
    hub = await Hub.query().findOne({handle: ctx.params.publicKeyOrHandle})
  }
  return hub
}