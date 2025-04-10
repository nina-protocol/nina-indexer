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
  try {
    let { offset = 0, limit = 2, sort = 'desc', query = '', includePosts = 'false' } = ctx.query;
    offset = Number(offset);
    limit = Number(limit);
    
    const [accountsPromise, releasesPromise, hubsPromise, tagsPromise] = await Promise.all([

      Account.query()
        .where('displayName', 'ilike', `%${query}%`)
        .orWhere('handle', 'ilike', `%${query}%`)
        .orderBy('displayName', sort)
        .range(offset, offset + limit - 1),

      Release.query()
        .where('archived', false)
        .whereNotIn('publisherId', idList)
        .whereIn('id', getReleaseSearchSubQuery(query))
        .orderBy('datetime', sort)
        .range(offset, offset + limit - 1),

      Hub.query()
        .where('handle', 'ilike', `%${query}%`)
        .orWhere(ref('data:displayName').castText(), 'ilike', `%${query}%`)
        .orderBy('datetime', sort)
        .range(offset, offset + limit - 1),

      Promise.all([
        Tag.query()
          .where('value', `${query}`)
          .first(),
        Tag.query()
          .where('value', 'like', `%${query}%`)
          .range(offset, offset + limit - 1)
      ])
    ]);

    // format results in parallel for each type
    const [accounts, releases, hubs, [exactMatch, tags]] = await Promise.all([
      accountsPromise,
      releasesPromise,
      hubsPromise,
      tagsPromise
    ]);

    const [
      formattedAccounts,
      formattedReleases,
      formattedHubs,
      formattedTags
    ] = await Promise.all([
      Promise.all(accounts.results.map(async account => {
        account.type = 'account';
        await account.format();
        return account;
      })),
      Promise.all(releases.results.map(async release => {
        release.type = 'release';
        await release.format();
        return release;
      })),
      Promise.all(hubs.results.map(async hub => {
        hub.type = 'hub';
        await hub.format();
        return hub;
      })),
      Promise.all(tags.results.map(async tag => {
        const count = await Tag.relatedQuery('releases').for(tag.id).resultSize();
        tag.count = count;
        tag.type = 'tag';
        await tag.format();
        return tag;
      }))
    ]);

    // match exact tag
    if (exactMatch && !formattedTags.find(tag => tag.id === exactMatch.id)) {
      const count = await Tag.relatedQuery('releases').for(exactMatch.id).resultSize();
      exactMatch.count = count;
      exactMatch.type = 'tag';
      await exactMatch.format();
      formattedTags.unshift(exactMatch);
    }

    formattedTags.sort((a, b) => b.count - a.count);

    let posts = { results: [], total: 0 };
    if (includePosts === 'true') {
      const postsQuery = await Post.query()
        .where(ref('data:title').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('data:description').castText(), 'ilike', `%${query}%`)
        .orWhereIn('hubId', getPublishedThroughHubSubQuery(query))
        .orderBy('datetime', sort)
        .range(offset, offset + limit - 1);

      const formattedPosts = await Promise.all(
        postsQuery.results.map(async post => {
          post.type = 'post';
          await post.format();
          return post;
        })
      );
      posts = {
        results: formattedPosts,
        total: postsQuery.total
      };
    }

    const response = {
      accounts: {
        results: formattedAccounts,
        total: accounts.total
      },
      releases: {
        results: formattedReleases,
        total: releases.total
      },
      hubs: {
        results: formattedHubs,
        total: hubs.total
      },
      tags: {
        results: formattedTags,
        total: tags.total
      },
    };

    if (includePosts === 'true') {
      response.posts = posts;
    }

    ctx.body = response;
  } catch (error) {
    console.log(error);
    ctx.status = 400;
    ctx.body = {
      message: 'Error fetching search results'
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
    ctx.status = 404
    ctx.body = {
      message: err
    }
  }
})

export default router