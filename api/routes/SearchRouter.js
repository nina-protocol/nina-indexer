import KoaRouter from 'koa-router'
import { 
  Account,
  Hub,
  Post,
  Release,
  Tag,
  Verification,
} from '@nina-protocol/nina-db';
import { ref } from 'objection'
import _  from 'lodash';

import { getReleaseSearchSubQuery, getPublishedThroughHubSubQuery } from '../utils.js';

const idList = [
  '13572',
]

const router = new KoaRouter({
  prefix: '/search'
})
router.get('/all', async (ctx) => {
  const { query = '', limit = 2, includePosts = false } = ctx.query;
  
  try {
    console.log('Starting search with query:', query);
    const searchPromises = [
      Tag.query()
        .where('value', 'like', `%${query}%`)
        .orderBy('value', 'desc')
        .limit(limit),
      Account.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('handle', 'ilike', `%${query}%`)
        .orderBy('displayName', 'desc')
        .limit(limit),
      Release.query()
        .where('archived', false)
        .whereNotIn('publisherId', idList)
        .whereIn('id', await getReleaseSearchSubQuery(query))
        .orderBy('datetime', 'desc')
        .limit(limit),
      Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orderBy('datetime', 'desc')
        .limit(limit)
    ];

    if (includePosts) {
      searchPromises.push(
        Post.query()
          .where(ref('data:title').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
          .orWhereIn('hubId', await getPublishedThroughHubSubQuery(query))
          .orderBy('datetime', 'desc')
          .limit(limit)
      );
    }

    const results = await Promise.all(searchPromises);
    const [tags, accounts, releases, hubs, ...posts] = results;
    console.log('Search queries completed successfully');

    // Format releases to include required properties
    const formattedReleases = releases.map(release => ({
      ...release,
      artist: release.metadata?.properties?.artist || '',
      type: 'release'
    }));
    console.log('Releases formatted successfully');

    ctx.status = 200;
    ctx.body = {
      tags: {
        results: tags,
        total: tags.length
      },
      accounts: {
        results: accounts,
        total: accounts.length
      },
      releases: {
        results: formattedReleases,
        total: formattedReleases.length
      },
      hubs: {
        results: hubs,
        total: hubs.length
      },
      ...(includePosts && {
        posts: {
          results: posts[0],
          total: posts[0].length
        }
      }),
      query
    };
    console.log('Response sent successfully');
  } catch (error) {
    console.error('Error in search all:', error);
    console.error('Error stack:', error.stack);
    ctx.status = 500;
    ctx.body = { error: 'Internal server error' };
  }
});

router.post('/v2', async (ctx) => {
  try { 
    let { offset=0, limit=20, sort='desc', query='' } = ctx.request.body;
    console.log('query', ctx.request.body)

    let accounts, releases, hubs, posts;

    if (!query) {
      // Get most recent items when no query is provided
      [accounts, releases, hubs, posts] = await Promise.all([
        Account.query()
          .orderBy('displayName', sort)
          .range(offset, offset + limit - 1),
        Release.query()
          .where('archived', false)
          .whereNotIn('publisherId', idList)
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1),
        Hub.query()
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1),
        Post.query()
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1)
      ]);
    } else {
      // Search with query
      [accounts, releases, hubs, posts] = await Promise.all([
        Account.query()
          .where('displayName', 'ilike', `%${query}%`)
          .orWhere('handle', 'ilike', `%${query}%`)
          .orderBy('displayName', sort)
          .range(offset, offset + limit - 1),
        Release.query()
          .where('archived', false)
          .whereNotIn('publisherId', idList)
          .whereIn('id', (await getReleaseSearchSubQuery(query)) || [])
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1),
        Hub.query()
          .where('handle', 'ilike', `%${query}%`)
          .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1),
        Post.query()
          .where(ref('data:title').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
          .orWhereIn('hubId', (await getPublishedThroughHubSubQuery(query)) || [])
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1)
      ]);
    }
    
    for await (let account of accounts) {
      account.type = 'account'
      await account.format()
    }

    const formattedReleasesResponse = []
    for await (let release of releases) {
      release.type = 'release'
      await release.format();
      formattedReleasesResponse.push(release)
    }
    
    for await (let hub of hubs) {
      hub.type = 'hub'
      await hub.format()
    }
    
    for await (let post of posts) {
      post.type = 'post'
      await post.format();
    }

    const all = [...formattedReleasesResponse, ...hubs, ...posts, ...accounts]
    if (sort === 'desc') {
      all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } else {
      all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    }

    ctx.body = {
      all: all.slice(Number(offset), Number(offset) + Number(limit)),
      total: all.length,
      query,
    }
  } catch (err) {
    console.error('Search v2 error:', err);
    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error while fetching search results'
    };
  }
})

router.post('/', async (ctx) => {
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
    console.error('Search error:', err);
    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error while fetching search results'
    };
  }
})

export default router