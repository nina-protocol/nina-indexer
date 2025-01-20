import KoaRouter from 'koa-router'
import { 
  Tag,
  config,
} from '@nina-protocol/nina-db';
import _  from 'lodash';
import Knex from 'knex'


const router = new KoaRouter({
  prefix: '/tags'
})

const db = Knex(config.development)

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

router.get('/:value', async (ctx) => {
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

export default router