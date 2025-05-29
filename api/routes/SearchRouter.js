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
import knex from 'knex'
import knexConfig from '../../db/src/knexfile.js'

import { getReleaseSearchSubQuery, getPublishedThroughHubSubQuery } from '../utils.js';

const idList = [
  '13572',
]

const router = new KoaRouter({
  prefix: '/search'
})

const db = knex(knexConfig.development)

router.get('/all', async (ctx) => {
  try {
    let { offset = 0, limit = 2, sort = 'desc', query = '', includePosts = 'false' } = ctx.query;
    offset = Number(offset);
    limit = Number(limit);
    
    // Initialize empty results for each section
    const response = {
      accounts: { results: [], total: 0 },
      releases: { results: [], total: 0 },
      hubs: { results: [], total: 0 },
      tags: { results: [], total: 0 },
      query
    };

    // If we have a query, check for releases first since that's the most common search
    let releaseIds = [];
    if (query) {
      releaseIds = await getReleaseSearchSubQuery(query);
    }

    const [accountsPromise, releasesPromise, hubsPromise, tagsPromise] = await Promise.all([
      Account.query()
        .modify((queryBuilder) => {
          if (query) {
            queryBuilder
              .where('displayName', 'ilike', `%${query}%`)
              .orWhere('handle', 'ilike', `%${query}%`);
          }
        })
        .orderBy('id', sort)
        .range(offset, offset + limit - 1),

      (async () => {
        if (query && releaseIds.length === 0) {
          return { results: [], total: 0 };
        }
        return Release.query()
          .where('archived', false)
          .whereNotIn('publisherId', idList)
          .modify((queryBuilder) => {
            if (query && releaseIds.length > 0) {
              queryBuilder.whereIn('id', releaseIds);
            }
          })
          .orderBy('datetime', sort)
          .range(offset, offset + limit - 1);
      })(),

      Hub.query()
        .modify((queryBuilder) => {
          if (query) {
            queryBuilder
              .where('handle', 'ilike', `%${query}%`)
              .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`);
          }
        })
        .orderBy('datetime', sort)
        .range(offset, offset + limit - 1),

      Tag.query()
        .select('tags.*')
        .count('tags_releases.tagId as count')
        .join('tags_releases', 'tags.id', 'tags_releases.tagId')
        .modify((queryBuilder) => {
          if (query) {
            queryBuilder.where('tags.value', 'ilike', `%${query}%`);
          }
        })
        .groupBy('tags.id')
        .orderBy('count', sort)
        .limit(limit)
        .offset(offset)
    ]);

    // format results in parallel for each type
    const [accounts, releases, hubs, tags] = await Promise.all([
      accountsPromise,
      releasesPromise,
      hubsPromise,
      tagsPromise
    ]);

    // Helper function to format results
    const formatResults = async (items, type, formatter) => {
      if (items.results.length === 0) return { results: [], total: items.total };
      
      const formatted = await Promise.all(items.results.map(async item => {
        await formatter(item);
        item.type = type;
        // Keep id and datetime for ordering
        if (type === 'account' || type === 'tag') {
          item.id = item.id;
        } else if (type === 'release' || type === 'hub') {
          item.datetime = item.datetime;
        }
        return item;
      }));
      
      return {
        results: formatted,
        total: items.total
      };
    };

    // Format each section
    response.accounts = await formatResults(accounts, 'account', account => account.format());
    response.releases = await formatResults(releases, 'release', release => release.format());
    response.hubs = await formatResults(hubs, 'hub', hub => hub.format());
    
    if (tags.length > 0) {
      const formattedTags = tags.map(tag => {
        const formattedTag = tag.toJSON();
        formattedTag.count = Number(tag.count);
        formattedTag.type = 'tag';
        return formattedTag;
      });

      response.tags = {
        results: formattedTags,
        total: tags.length
      };
    }

    if (includePosts === 'true') {
      const hubIds = await getPublishedThroughHubSubQuery(query);
      const postsQuery = await Post.query()
        .where(ref('data:title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
        .modify((queryBuilder) => {
          if (hubIds && hubIds.length > 0) {
            queryBuilder.orWhereIn('hubId', hubIds);
          }
        })
        .orderBy('datetime', sort)
        .range(offset, offset + limit - 1);

      response.posts = await formatResults(postsQuery, 'post', post => post.format());
    }

    ctx.status = 200;
    ctx.body = response;
  } catch (error) {
    console.error('Error in search all:', error);
    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error while fetching search results'
    };
  }
});

router.post('/v2', async (ctx) => {
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

    const releaseIds = await getReleaseSearchSubQuery(query);
    const releases = await Release.query()
      .where('archived', false)
      .whereNotIn('publisherId', idList)
      .modify((queryBuilder) => {
        if (releaseIds && releaseIds.length > 0) {
          queryBuilder.whereIn('id', releaseIds);
        }
      });
    
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

    ctx.status = 200;
    ctx.body = {
      all: all.slice(Number(offset), Number(offset) + Number(limit)),
      total: all.length,
      query,
    }
  } catch (err) {
    console.error('Error in search v2:', err);
    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error while fetching search results'
    }
  }
})

router.post('/', async (ctx) => {
  try { 
    const { query } = ctx.request.body;

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

    ctx.status = 200;
    ctx.body = {
      accounts: _.uniqBy(verifications, x => x.account),
      releases: _.uniqBy(formattedReleasesResponse, x => x.publicKey),
      hubs: _.uniqBy(formattedHubsResponse, x => x.publicKey),
    }
  } catch (err) {
    console.error('Error in search:', err);
    ctx.status = 500;
    ctx.body = {
      message: 'Internal server error while fetching search results'
    }
  }
})

export default router