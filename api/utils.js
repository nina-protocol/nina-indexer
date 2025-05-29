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
  try {
    // Get release IDs based only on text content
    const releaseIds = await withCache(
      `release:search:${query}`,
      async () => {
        console.error('\n\n========== SEARCH DEBUG START ==========');
        console.error('Search Query:', query);
        
        const releases = await Release.query()
          .select('id', 'metadata')
          .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('metadata:description').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('metadata:properties.title').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('metadata:properties.tags').castText(), 'ilike', `%${query}%`)
          .orWhere(ref('metadata:collection.name').castText(), 'ilike', `%${query}%`);

        console.error('\nMatching Releases:');
        releases.forEach(release => {
          const matches = [];
          
          // Check each field for matches
          if (release.metadata?.name?.toLowerCase().includes(query.toLowerCase())) {
            matches.push(`name: "${release.metadata.name}"`);
          }
          if (release.metadata?.description?.toLowerCase().includes(query.toLowerCase())) {
            matches.push(`description: "${release.metadata.description}"`);
          }
          if (release.metadata?.properties?.title?.toLowerCase().includes(query.toLowerCase())) {
            matches.push(`title: "${release.metadata.properties.title}"`);
          }
          if (release.metadata?.properties?.tags?.some(tag => tag.toLowerCase().includes(query.toLowerCase()))) {
            matches.push(`tags: [${release.metadata.properties.tags.join(', ')}]`);
          }
          if (release.metadata?.collection?.name?.toLowerCase().includes(query.toLowerCase())) {
            matches.push(`collection: "${release.metadata.collection.name}"`);
          }

          console.error('\nRelease:', {
            id: release.id,
            matches: matches
          });
        });
        console.error('\nTotal matches:', releases.length);
        console.error('========== SEARCH DEBUG END ==========\n\n');

        return releases.map(row => row.id);
      }
    );

    return releaseIds;
  } catch (error) {
    console.error('Error in getReleaseSearchSubQuery:', error);
    return [];
  }
};

export const getPublisherSubQuery = async (query) => {
  const cacheKey = `publisher:search:${query}`;
  
  return withCache(cacheKey, async () => {
    const publishers = await Account.query()
      .select('id')
      .where('displayName', 'ilike', `%${query}%`)
      .orWhere('handle', 'ilike', `%${query}%`);

    // Ensure we're returning an array of numbers
    const publisherIds = publishers.map(publisher => {
      const id = typeof publisher === 'object' ? publisher.id : publisher;
      const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
      if (isNaN(parsedId)) {
        return null;
      }
      return parsedId;
    }).filter(id => id !== null);

    return publisherIds;
  });
}

export const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

export const BIG_LIMIT = 5000;
