const { ref } = require('objection');
const _ = require('lodash');

const Account = require('../indexer/db/models/Account');
const Hub = require('../indexer/db/models/Hub');
const Post = require('../indexer/db/models/Post');
const Release = require('../indexer/db/models/Release');

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
      ctx.body = {collected, published, hubs, posts, exchanges};
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
      const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      await release.format();
      
      ctx.body = { release };
    } catch (err) {
      console.log(err)
      releaseNotFound(ctx)
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
      releaseNotFound(ctx)
    }
  });

  router.get('/releases/:publicKey/collectors', async (ctx) => {
    try {
      const release = await Release.query().findOne({publicKey: ctx.params.publicKey})
      const collectors = await release.$relatedQuery('collectors')
      for await (let account of collectors) {
        await account.format();
      }
      ctx.body = { collectors };
    } catch (err) {
      console.log(err)
      releaseNotFound(ctx)
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
      releaseNotFound(ctx)
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
      const hub = await hubForPublicKeyOrHandle(ctx)
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
      hubNotFound(ctx)
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
}

const hubNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `Hub not found with publicKey: ${ctx.params.publicKeyOrHandle}`
  }
}

const releaseNotFound = (ctx) => {
  ctx.status = 404
  ctx.body = {
    message: `Release not found with publicKey: ${ctx.params.publicKey}`
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
  console.log(ctx.params)
  let hub = await Hub.query().findOne({publicKey: ctx.params.publicKeyOrHandle})
  if (!hub) {
    hub = await Hub.query().findOne({handle: ctx.params.publicKeyOrHandle})
  }
  return hub
}
