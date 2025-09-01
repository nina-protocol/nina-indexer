import { ref } from 'objection'
import {
  Account,
  Hub,
  Release,
} from '@nina-protocol/nina-db'


export const formatColumnForJsonFields = (column, fieldName='metadata') => {
  if (column.includes(':')) {
    column = fieldName + ':' + column.split(':')[1]
    column = ref(column).castText()
  }
  return column
}

export const getPublishedThroughHubSubQuery = async (query) => {
  try {
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
  } catch (error) {
    console.error('Error in getPublishedThroughHubSubQuery:', error);
    return [];
  }
}

export const getReleaseSearchSubQuery = async (query) => {
  try {
    // Get release IDs based only on text content
      const releases = await Release.query()
        .select('id', 'metadata')
        .where(ref('metadata:name').castText(), 'ilike', `%${query}%`)
        .orWhere(ref('metadata:properties.tags').castText(), 'ilike', `%${query}%`)

      return releases.map(row => row.id);
  } catch (error) {
    console.error('Error in getReleaseSearchSubQuery:', error);
    return [];
  }
};

export const getPublisherSubQuery = async (query) => {
  try {
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
    
  } catch (error) {
    console.error('Error in getPublisherSubQuery:', error);
    return [];
  }
}

export const sleep = (time) => new Promise(resolve => setTimeout(resolve, time))

export const BIG_LIMIT = 5000;
