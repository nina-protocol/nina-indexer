import { ref } from 'objection'
import Knex from 'knex'
import {
  Account,
  Hub,
  Release,
  config,
} from '@nina-protocol/nina-db'
import { withCache } from '../utils/redis.js'

const db = Knex(config.development)

export const formatColumnForJsonFields = (column, fieldName='metadata') => {
  if (column.includes(':')) {
    column = fieldName + ':' + column.split(':')[1]
    column = ref(column).castText()
  }
  return column
}

export const getPublishedThroughHubSubQuery = async (query) => {
  const cacheKey = `hub:search:${query}`;
  
  return withCache(cacheKey, async () => {
    console.log(`[Cache Miss] Executing hub search query for: ${query}`);
    const hubs = await Hub.query()
      .select('id')
      .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
      .orWhere('handle', 'ilike', `%${query}%`);

    // Ensure we're returning an array of numbers
    const hubIds = hubs.map(hub => {
      const id = typeof hub === 'object' ? hub.id : hub;
      return typeof id === 'string' ? parseInt(id, 10) : id;
    }).filter(id => !isNaN(id));

    return hubIds;
  });
}

export const getReleaseSearchSubQuery = async (query) => {
  console.log(`[Search] Starting getReleaseSearchSubQuery for query: "${query}"`);
  try {
    // Get hub IDs
    console.log(`[Search] Fetching hub IDs for query: "${query}"`);
    const hubIds = await withCache(
      `hub:search:${query}`,
      async () => {
        console.log(`[Search] Cache miss for hub search, executing query`);
        const result = await Hub.query()
          .select('id')
          .where(ref('data:displayName').castText(), 'ilike', `%${query}%`)
          .orWhere('handle', 'ilike', `%${query}%`);
        console.log(`[Search] Hub query returned ${result.length} results`);
        return result.map(row => row.id);
      }
    );
    console.log(`[Search] Retrieved hub IDs:`, hubIds);

    // Get publisher IDs using Account model
    console.log(`[Search] Fetching publisher IDs for query: "${query}"`);
    const publisherIds = await withCache(
      `publisher:search:${query}`,
      async () => {
        console.log(`[Search] Cache miss for publisher search, executing query`);
        const accounts = await Account.query()
          .select('id')
          .where('displayName', 'ilike', `%${query}%`)
          .orWhere('handle', 'ilike', `%${query}%`);
        console.log(`[Search] Publisher query returned ${accounts.length} results`);
        return accounts.map(account => account.id);
      }
    );
    console.log(`[Search] Retrieved publisher IDs:`, publisherIds);

    // Ensure all IDs are integers
    const safeHubIds = (Array.isArray(hubIds) ? hubIds : [])
      .map(id => {
        if (typeof id === 'object' && id !== null) return id.id;
        return typeof id === 'string' ? parseInt(id, 10) : id;
      })
      .filter(id => !isNaN(id));

    const safePublisherIds = (Array.isArray(publisherIds) ? publisherIds : [])
      .map(id => {
        if (typeof id === 'object' && id !== null) return id.id;
        return typeof id === 'string' ? parseInt(id, 10) : id;
      })
      .filter(id => !isNaN(id));

    console.log('[Search] Safe hub IDs:', safeHubIds);
    console.log('[Search] Safe publisher IDs:', safePublisherIds);

    // Get release IDs
    console.log(`[Search] Fetching release IDs for query: "${query}"`);
    const releaseIds = await withCache(
      `release:search:${query}`,
      async () => {
        console.log(`[Search] Cache miss for release search, executing query`);
        const result = await Release.query()
          .select('id')
          .where(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('metadata:description').castText(), 'ilike', `%${query}%`)
          .orWhereIn('hubId', safeHubIds)
          .orWhereIn('publisherId', safePublisherIds);
        console.log(`[Search] Release query returned ${result.length} results`);
        return result.map(row => row.id);
      }
    );

    console.log('[Search] Final release IDs:', releaseIds);
    return releaseIds;
  } catch (error) {
    console.error('[Search] Error in getReleaseSearchSubQuery:', error);
    console.error('[Search] Error stack:', error.stack);
    return [];
  }
};

export const getPublisherSubQuery = async (query) => {
  const cacheKey = `publisher:search:${query}`;
  
  return withCache(cacheKey, async () => {
    console.log(`[Cache Miss] Executing publisher search query for: ${query}`);
    const publishers = await Account.query()
      .select('id')
      .where('displayName', 'ilike', `%${query}%`)
      .orWhere('handle', 'ilike', `%${query}%`);

    // Ensure we're returning an array of numbers
    const publisherIds = publishers.map(publisher => {
      const id = typeof publisher === 'object' ? publisher.id : publisher;
      const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
      if (isNaN(parsedId)) {
        console.warn(`Invalid publisher ID found: ${id}`);
        return null;
      }
      return parsedId;
    }).filter(id => id !== null);

    console.log(`Publisher IDs after conversion: ${JSON.stringify(publisherIds)}`);
    return publisherIds;
  });
}

export const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

export const BIG_LIMIT = 5000;
