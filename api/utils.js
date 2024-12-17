import { ref } from 'objection'
import Knex from 'knex'
import {
  Hub,
  Release,
  config,
} from '@nina-protocol/nina-db'

const db = Knex(config.development)

export const formatColumnForJsonFields = (column, fieldName='metadata') => {
  if (column.includes(':')) {
    column = fieldName + ':' + column.split(':')[1]
    column = ref(column).castText()
  }
  return column
}

export const getPublishedThroughHubSubQuery = (query) => {
  const publishedThroughHubSubQuery = Hub.query()
    .select('id')
    .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
    .orWhere('handle', 'ilike', `%${query}%`)

  return publishedThroughHubSubQuery
}

export const getReleaseSearchSubQuery = (query) => {
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

export const getPublisherSubQuery = (query) => {
  const publisherSubQuery = Account.query()
    .select('id')
    .where('displayName', 'ilike', `%${query}%`)
    .orWhere('handle', 'ilike', `%${query}%`)

  return publisherSubQuery
}

export const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

export const BIG_LIMIT = 5000;
