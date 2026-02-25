import KoaRouter from 'koa-router'
import { Account, Hub, Post, Tag, redis } from '@nina-protocol/nina-db';
import _ from 'lodash';
import axios from 'axios';
import knex from 'knex'
import knexConfig from '../../db/src/knexfile.js'

const router = new KoaRouter({
  prefix: '/tags'
})

const db = knex(knexConfig.development)
const authDb = knex(knexConfig.development.auth)

router.get('/', async (ctx) => {
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

    const tags = await db('tags')
      .select('tags.*')
      .count('tags_releases.tagId as count')
      .join('tags_releases', 'tags.id', 'tags_releases.tagId')
      .where('tags.value', 'ilike', `${queryString}%`)
      .groupBy('tags.id')
      .orderBy('count', sort)
      .limit(limit)
      .offset(offset);
      
    const total = await Tag.query().where('value', 'ilike', `%${query}%`).resultSize()
  
    for await (let tag of tags) {
      tag.count = Number(tag.count)
      delete tag.id
    }
    ctx.body = {
      tags: {
        results: tags,
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

router.get('/stats/trending', async (ctx) => {
  try {
    const { window = '7d', limit = 20, override = 'false' } = ctx.query;
    const cacheKey = `tags:trending:batch:${window}:${limit}`;

    const result = await redis.withCache(cacheKey, async () => {
      const endpoint = process.env.NINA_RECOMMENDATIONS_ENDPOINT;
      if (!endpoint) {
        throw new Error('NINA_RECOMMENDATIONS_ENDPOINT is not configured');
      }

      // Fetch trending tags from recommendation engine
      const response = await axios.get(`${endpoint}/tags/trending`, {
        params: { window, limit },
        timeout: 10000,
      });

      const trendingTags = response.data?.data?.tags || response.data?.tags || [];

      // Weekly date range for favorites sorting
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const tags = [];

      for (const trendingTag of trendingTags) {
        const tag = await Tag.query().findOne({ value: trendingTag.tagValue.toLowerCase() });
        if (!tag) continue;

        // Get non-archived releases for this tag
        const allReleases = await Tag.relatedQuery('releases').for(tag.id).where('releases.archived', false);
        if (allReleases.length === 0) continue;

        // Get weekly favorite counts
        const releasePublicKeys = allReleases.map(release => release.publicKey);
        const releaseFavoriteCounts = await authDb('favorites')
          .select('public_key')
          .count('* as favorite_count')
          .where('favorite_type', 'release')
          .whereIn('public_key', releasePublicKeys)
          .where('created_at', '>=', startDate.toISOString())
          .groupBy('public_key');

        const releaseFavoriteCountMap = _.keyBy(releaseFavoriteCounts, 'public_key');
        let rankedReleases = allReleases.map(release => ({
          release,
          favoriteCount: parseInt(releaseFavoriteCountMap[release.publicKey]?.favorite_count || 0)
        }));

        // Sort by favorites desc, take top 5
        rankedReleases = _.orderBy(rankedReleases, ['favoriteCount', 'publicKey'], ['desc', 'asc']);
        rankedReleases = rankedReleases.slice(0, 5);

        // Format releases (must call format() on Objection model instances before spreading)
        const formattedReleases = [];
        for (const { release } of rankedReleases) {
          await release.format();
          formattedReleases.push({ ...release, type: 'release' });
        }

        if (formattedReleases.length === 0) continue;

        tags.push({
          tagValue: trendingTag.tagValue,
          rank: trendingTag.rank,
          alltimeRank: trendingTag.alltimeRank,
          rankDiff: trendingTag.rankDiff,
          releases: formattedReleases,
        });
      }

      return { tags, timeWindow: window };
    }, 86400, override === 'true');

    ctx.body = result;
  } catch (error) {
    console.warn(error);
    ctx.status = 400;
    ctx.body = {
      success: false,
    };
  }
});

router.get('/:value', async (ctx) => {
  try {
    let { offset = 0, limit = 20, sort = 'desc', column = 'datetime', daterange, full = 'false' } = ctx.query;
    const includeBlocks = full === 'true';
    const tag = await Tag.query().findOne({ value: ctx.params.value.toLowerCase() });

    if (!tag) {
      ctx.status = 404;
      ctx.body = { success: false, message: 'Tag not found' };
      return;
    }

    // Get all releases for the tag
    let releasesQuery = Tag.relatedQuery('releases').for(tag.id).where('releases.archived', false);
    let allReleases = await releasesQuery;
    const totalReleases = allReleases.length;

    // Get all posts for the tag
    let postsQuery = Tag.relatedQuery('posts').for(tag.id).where('posts.archived', false);
    let allPosts = await postsQuery;
    const totalPosts = allPosts.length;

    let paginatedReleases;
    let paginatedPosts;

    if (column === 'favorites') {
      // daterange param
      let dateCondition = {};
      if (daterange) {
        const startDate = new Date();
        if (daterange === 'daily') {
          startDate.setDate(startDate.getDate() - 1);
        } else if (daterange === 'weekly') {
          startDate.setDate(startDate.getDate() - 7);
        } else if (daterange === 'monthly') {
          startDate.setMonth(startDate.getMonth() - 1);
        }
        dateCondition = { created_at: { $gte: startDate.toISOString() } };
      }

      // get favorite counts for all releases in this tag
      const releasePublicKeys = allReleases.map(release => release.publicKey);
      const releaseFavoriteCounts = await authDb('favorites')
        .select('public_key')
        .count('* as favorite_count')
        .where('favorite_type', 'release')
        .whereIn('public_key', releasePublicKeys)
        .modify(queryBuilder => {
          if (Object.keys(dateCondition).length > 0) {
            queryBuilder.where('created_at', '>=', dateCondition.created_at.$gte);
          }
        })
        .groupBy('public_key');

      // map the favorite counts to the releases
      const releaseFavoriteCountMap = _.keyBy(releaseFavoriteCounts, 'public_key');
      allReleases = allReleases.map(release => ({
        ...release,
        favoriteCount: parseInt(releaseFavoriteCountMap[release.publicKey]?.favorite_count || 0)
      }));

      allReleases = _.orderBy(
        allReleases,
        ['favoriteCount', 'publicKey'],
        [sort.toLowerCase(), 'asc']
      );

      paginatedReleases = allReleases.slice(
        Number(offset),
        Number(offset) + Number(limit)
      );

      // format releases
      for (const release of paginatedReleases) {
        const publisher = await Account.query().findOne({ id: release.publisherId })
        await publisher.format()
        release.publisherAccount = publisher

        if (release.hubId) {
          const hub = await Hub.query().findOne({ id: release.hubId })
          await hub.format()
          release.hub = hub
        }

        delete release.publisherId
        delete release.hubId
        delete release.id
      }

      // format posts first before converting to plain objects
      for (const post of allPosts) {
        await post.format({ includeBlocks });
      }

      // get favorite counts for all posts in this tag
      const postPublicKeys = allPosts.map(post => post.publicKey);
      const postFavoriteCounts = await authDb('favorites')
        .select('public_key')
        .count('* as favorite_count')
        .where('favorite_type', 'post')
        .whereIn('public_key', postPublicKeys)
        .modify(queryBuilder => {
          if (Object.keys(dateCondition).length > 0) {
            queryBuilder.where('created_at', '>=', dateCondition.created_at.$gte);
          }
        })
        .groupBy('public_key');

      // map the favorite counts to the posts
      const postFavoriteCountMap = _.keyBy(postFavoriteCounts, 'public_key');
      allPosts = allPosts.map(post => ({
        ...post,
        favoriteCount: parseInt(postFavoriteCountMap[post.publicKey]?.favorite_count || 0)
      }));

      allPosts = _.orderBy(
        allPosts,
        ['favoriteCount', 'publicKey'],
        [sort.toLowerCase(), 'asc']
      );

      paginatedPosts = allPosts.slice(
        Number(offset),
        Number(offset) + Number(limit)
      );

      ctx.body = {
        releases: paginatedReleases,
        posts: paginatedPosts,
        total: totalReleases,
        totalPosts
      };
    } else {
      // for non-favorite sorting, use the existing query with pagination
      const releases = await releasesQuery
        .orderBy(column, sort)
        .range(
          Number(offset),
          Number(offset) + Number(limit) - 1
        );

      for (const release of releases.results) {
        await release.format();
      }

      const posts = await postsQuery
        .orderBy(column, sort)
        .range(
          Number(offset),
          Number(offset) + Number(limit) - 1
        );

      for (const post of posts.results) {
        await post.format({ includeBlocks });
      }

      ctx.body = {
        releases: releases.results,
        posts: posts.results,
        total: releases.total,
        totalPosts: posts.total
      };
    }
  } catch (error) {
    console.warn(error);
    ctx.status = 400;
    ctx.body = {
      success: false
    };
  }
});

export default router