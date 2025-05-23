import { getReleaseSearchSubQuery } from '../api/utils.js';
import { connectDb } from '@nina-protocol/nina-db';
import dotenv from 'dotenv';

dotenv.config();

const testQuery = async (query) => {
  console.log(`\nTesting search query: "${query}"`);
  console.log('----------------------------------------');
  
  // First query (should be a cache miss)
  console.time('First Query');
  const result1 = await getReleaseSearchSubQuery(query);
  console.timeEnd('First Query');
  
  // Wait a second to make the timing more clear
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Second query (should be a cache hit)
  console.time('Second Query');
  const result2 = await getReleaseSearchSubQuery(query);
  console.timeEnd('Second Query');
  
  // Wait a second
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Third query (should be a cache hit)
  console.time('Third Query');
  const result3 = await getReleaseSearchSubQuery(query);
  console.timeEnd('Third Query');
  
  console.log('----------------------------------------');
  console.log('Results length:', result1.length);
  console.log('All results match:', 
    result1.length === result2.length && 
    result2.length === result3.length
  );
};

// Run the test
const runTest = async () => {
  try {
    // Initialize database connection
    console.log('Connecting to database...');
    await connectDb();
    console.log('Database connected successfully');

    // Test with a few different queries
    await testQuery('surfing');
    await testQuery('rock');
    await testQuery('electronic');
  } catch (error) {
    console.error('Test failed:', error);
  }
};

runTest(); 