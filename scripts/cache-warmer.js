import { getReleaseSearchSubQuery } from '../api/utils.js';
import { connectDb } from '@nina-protocol/nina-db';
import dotenv from 'dotenv';

dotenv.config();

// Common search terms to pre-warm
const COMMON_SEARCH_TERMS = [
  'jazz',
  'rock',
  'electronic',
  'hip hop',
  'classical',
  'pop',
  'house',
  'techno',
  'ambient',
  'experimental'
];

const warmCache = async () => {
  try {
    console.log('Connecting to database...');
    await connectDb();
    console.log('Database connected successfully');

    console.log('Starting cache warm-up...');
    
    for (const term of COMMON_SEARCH_TERMS) {
      console.log(`Warming cache for term: ${term}`);
      try {
        await getReleaseSearchSubQuery(term);
        console.log(`Successfully cached results for: ${term}`);
      } catch (error) {
        console.error(`Failed to cache results for ${term}:`, error);
      }
      // Add a small delay between queries to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('Cache warm-up completed!');
    process.exit(0);
  } catch (error) {
    console.error('Cache warm-up failed:', error);
    process.exit(1);
  }
};

warmCache(); 