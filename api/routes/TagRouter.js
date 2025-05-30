import KoaRouter from 'koa-router'
import { Account, Hub, Tag } from '@nina-protocol/nina-db';
import _ from 'lodash';
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

router.get('/:value', async (ctx) => {
  try {
    let { offset = 0, limit = 20, sort = 'desc', column = 'datetime', daterange } = ctx.query;
    const tag = await Tag.query().findOne({ value: ctx.params.value.toLowerCase() });

    if (!tag) {
      ctx.status = 404;
      ctx.body = { success: false, message: 'Tag not found' };
      return;
    }

    //  get all releases for the tag
    let releasesQuery = Tag.relatedQuery('releases').for(tag.id).where('releases.archived', false);
    let allReleases = await releasesQuery;
    const total = allReleases.length;

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
      const publicKeys = allReleases.map(release => release.publicKey);
      const favoriteCounts = await authDb('favorites')
        .select('public_key')
        .count('* as favorite_count')
        .where('favorite_type', 'release')
        .whereIn('public_key', publicKeys)
        .modify(queryBuilder => {
          if (Object.keys(dateCondition).length > 0) {
            queryBuilder.where('created_at', '>=', dateCondition.created_at.$gte);
          }
        })
        .groupBy('public_key');

      // map the favorite counts to the releases
      const favoriteCountMap = _.keyBy(favoriteCounts, 'public_key');
      allReleases = allReleases.map(release => ({
        ...release,
        favoriteCount: parseInt(favoriteCountMap[release.publicKey]?.favorite_count || 0)
      }));

      allReleases = _.orderBy(
        allReleases,
        ['favoriteCount', 'publicKey'],
        [sort.toLowerCase(), 'asc']
      );

      const paginatedReleases = allReleases.slice(
        Number(offset),
        Number(offset) + Number(limit)
      );

      // format releases
      for (const release of paginatedReleases) {
        // release.filter() was undefined, so we are adding hub and publisher manually
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

      ctx.body = {
        releases: paginatedReleases,
        total
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

      ctx.body = {
        releases: releases.results,
        total: releases.total
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