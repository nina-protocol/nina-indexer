import request from 'supertest';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { connectDb } from '@nina-protocol/nina-db';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('Performance Tests - /all Endpoint', function() {
  before(async function() {
    await connectDb();
  });

  const calculateStats = (numbers) => {
    const sorted = numbers.sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const median = sorted.length % 2 === 0 
      ? (sorted[sorted.length/2 - 1] + sorted[sorted.length/2]) / 2
      : sorted[Math.floor(sorted.length/2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    return {
      mean: Math.round(mean),
      median: Math.round(median),
      min: Math.round(min),
      max: Math.round(max),
      p95: Math.round(p95),
      p99: Math.round(p99)
    };
  };

  describe.only('Basic /all Performance', function() {
    it.only('should return results within acceptable time', async function() {
      this.timeout(30000);
      const iterations = 10;
      const responseTimes = [];
      
      console.log(`Running ${iterations} iterations of /all endpoint test...`);
      
      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        const response = await request(process.env.MOCHA_ENDPOINT_URL)
          .get('/v1/search/all');
        const endTime = Date.now();
        
        expect(response.status).to.equal(200);
        expect(response.body).to.have.property('accounts');
        expect(response.body).to.have.property('releases');
        expect(response.body).to.have.property('hubs');
        expect(response.body).to.have.property('tags');
        
        const responseTime = endTime - startTime;
        responseTimes.push(responseTime);
        
        console.log(`Iteration ${i + 1}/${iterations}: ${responseTime}ms`);
        
        // delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // stats
      const stats = calculateStats(responseTimes);
      console.log('\nResponse Time Statistics (ms):');
      console.log('-----------------------------');
      console.log(`Mean: ${stats.mean}`);
      console.log(`Median: ${stats.median}`);
      console.log(`Min: ${stats.min}`);
      console.log(`Max: ${stats.max}`);
      console.log(`95th percentile: ${stats.p95}`);
      console.log(`99th percentile: ${stats.p99}`);

      // histogram
      expect(stats.p95).to.be.below(3000, '95th percentile should be under 3000ms');
      expect(stats.median).to.be.below(1500, 'Median response time should be under 1500ms');
      expect(stats.max).to.be.below(5000, 'Maximum response time should be under 5000ms');
    });
  });
});