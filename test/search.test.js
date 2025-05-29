import request from 'supertest';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { connectDb } from '@nina-protocol/nina-db';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('/search tests', function() {
  before(async function() {
    await connectDb();
  });

  describe('/search posts response output', function() {
    it('should return proper structure for /search/all with posts', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/search/all?includePosts=true');

        // console.log('response :>> ', response);
      
      expect(response.status).to.equal(200);
      
      // ensure results array exists
      expect(response.body).to.have.property('posts');
      expect(response.body).to.have.property('releases');
      expect(response.body.posts).to.be.an('object');
      expect(response.body.posts).to.have.property('results');
      expect(response.body.posts.results).to.be.an('array');
      
      // ensure posts has total
      expect(response.body.posts).to.have.property('total');
      expect(response.body.posts.total).to.be.a('number');
    });

    it('should return 2 most recent results for each resource type when no query is provided', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/search/all');
      
      expect(response.status).to.equal(200);
      
      // Check accounts
      expect(response.body).to.have.property('accounts');
      expect(response.body.accounts).to.have.property('results');
      expect(response.body.accounts.results).to.be.an('array');
      expect(response.body.accounts.results.length).to.be.at.most(2);
      expect(response.body.accounts).to.have.property('total');
      expect(response.body.accounts.total).to.be.a('number');
      
      // Check releases
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.have.property('results');
      expect(response.body.releases.results).to.be.an('array');
      expect(response.body.releases.results.length).to.be.at.most(2);
      expect(response.body.releases).to.have.property('total');
      expect(response.body.releases.total).to.be.a('number');
      
      // Check hubs
      expect(response.body).to.have.property('hubs');
      expect(response.body.hubs).to.have.property('results');
      expect(response.body.hubs.results).to.be.an('array');
      expect(response.body.hubs.results.length).to.be.at.most(2);
      expect(response.body.hubs).to.have.property('total');
      expect(response.body.hubs.total).to.be.a('number');
      
      // Check tags
      expect(response.body).to.have.property('tags');
      expect(response.body.tags).to.have.property('results');
      expect(response.body.tags.results).to.be.an('array');
      expect(response.body.tags.results.length).to.be.at.most(2);
      expect(response.body.tags).to.have.property('total');
      expect(response.body.tags.total).to.be.a('number');
    });

    it('should not return posts by default for /search/all', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/search/all');
      
      expect(response.status).to.equal(200);
      expect(response.body).to.not.have.property('posts');
    });

    it('should return proper structure with query param', async function() {
      const query = 'test';
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/search/all?includePosts=true&query=${query}`);
      
      expect(response.status).to.equal(200);
      
      // posts structure with query
      expect(response.body).to.have.property('posts');
      expect(response.body.posts).to.be.an('object');
      expect(response.body.posts).to.have.property('results');
      expect(response.body.posts.results).to.be.an('array');
      expect(response.body.posts).to.have.property('total');
      expect(response.body.posts.total).to.be.a('number');
    });
  });

  describe('Release Router Tests', function() {
    it('should return proper structure for /releases index', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/releases');

      
      expect(response.status).to.equal(200);
      
      console.log('response.body.release.length :>> ', response.body.releases.length);

      // Check basic response structure
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.be.an('array');
      expect(response.body).to.have.property('total');
      expect(response.body.total).to.be.a('number');
      expect(response.body).to.have.property('query');
      
      // Check release object structure if results exist
      if (response.body.releases.length > 0) {
        const release = response.body.releases[0];
        expect(release).to.have.property('publicKey');
        expect(release).to.have.property('metadata');
        expect(release.metadata).to.have.property('properties');
        expect(release.metadata.properties).to.have.property('files');
        expect(release.metadata.properties).to.have.property('title');
      }
    });

    it('should handle query parameters for /releases index', async function() {
      const query = 'surfing';
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/releases?query=${query}&limit=10&offset=0&sort=desc`);
      
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.be.an('array');
      expect(response.body.releases.length).to.be.at.most(10);
      expect(response.body).to.have.property('query');
      expect(response.body.query).to.equal(query);
    });

    it('should return consistent releases between search and release router', async function() {
      // Get first 2 releases from search endpoint
      const searchResponse = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/search/all?limit=2&offset=0&sort=desc');
      
      expect(searchResponse.status).to.equal(200);
      expect(searchResponse.body).to.have.property('releases');
      expect(searchResponse.body.releases.results).to.be.an('array');
      expect(searchResponse.body.releases.results.length).to.be.at.most(2);

      // Get first 2 releases from releases endpoint
      const releasesResponse = await request(process.env.MOCHA_ENDPOINT_URL)
        .get('/v1/releases?limit=2&offset=0&sort=desc');
      
      expect(releasesResponse.status).to.equal(200);
      expect(releasesResponse.body).to.have.property('releases');
      expect(releasesResponse.body.releases).to.be.an('array');
      expect(releasesResponse.body.releases.length).to.be.at.most(2);

      // Compare the releases
      const searchReleases = searchResponse.body.releases.results;
      const routerReleases = releasesResponse.body.releases;

      // Check if we have releases to compare
      if (searchReleases.length > 0 && routerReleases.length > 0) {
        // Compare each release's publicKey and datetime
        for (let i = 0; i < Math.min(searchReleases.length, routerReleases.length); i++) {
          expect(searchReleases[i].publicKey).to.equal(routerReleases[i].publicKey);
          expect(searchReleases[i].datetime).to.equal(routerReleases[i].datetime);
        }
      }
    });

    it('should return consistent releases between search and release router with search query', async function() {
      const query = 'surf'; // Using a common search term
      
      // Get first 2 releases from search endpoint with query
      const searchResponse = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/search/all?limit=2&offset=0&sort=desc&query=${query}`);
      
      expect(searchResponse.status).to.equal(200);
      expect(searchResponse.body).to.have.property('releases');
      expect(searchResponse.body.releases.results).to.be.an('array');
      expect(searchResponse.body.releases.results.length).to.be.at.most(2);

      // Get first 2 releases from releases endpoint with same query
      const releasesResponse = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/releases?limit=2&offset=0&sort=desc&query=${query}`);
      
      expect(releasesResponse.status).to.equal(200);
      expect(releasesResponse.body).to.have.property('releases');
      expect(releasesResponse.body.releases).to.be.an('array');
      expect(releasesResponse.body.releases.length).to.be.at.most(2);

      // Compare the releases
      const searchReleases = searchResponse.body.releases.results;
      const routerReleases = releasesResponse.body.releases;

      // Check if we have releases to compare
      if (searchReleases.length > 0 && routerReleases.length > 0) {
        // Compare each release's publicKey and datetime
        for (let i = 0; i < Math.min(searchReleases.length, routerReleases.length); i++) {
          expect(searchReleases[i].publicKey).to.equal(routerReleases[i].publicKey);
          expect(searchReleases[i].datetime).to.equal(routerReleases[i].datetime);
        }
      }

      // Also verify that the results are actually filtered by the query
      if (searchReleases.length > 0) {
        const release = searchReleases[0];
        // Check that the release matches the search query in some way
        const matchesQuery = 
          (release.metadata?.properties?.title?.toLowerCase().includes(query.toLowerCase())) ||
          (release.metadata?.properties?.artist?.toLowerCase().includes(query.toLowerCase())) ||
          (release.metadata?.description?.toLowerCase().includes(query.toLowerCase()));
        expect(matchesQuery).to.be.true;
      }
    });

    it('should handle no results for /releases with bogus query', async function() {
      const bogusQuery = 'x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6';
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/releases?query=${bogusQuery}`)
              
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.be.an('array');
      expect(response.body.releases).to.have.length(0);
      expect(response.body).to.have.property('total');
      expect(response.body.total).to.equal(0);
      expect(response.body).to.have.property('query');
      expect(response.body.query).to.equal(bogusQuery);
    });

    it('should handle no results for /search/all with bogus query', async function() {
      const bogusQuery = 'x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6';
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/search/all?query=${bogusQuery}`);
      
      expect(response.status).to.equal(200);
      
      // Check accounts
      expect(response.body).to.have.property('accounts');
      expect(response.body.accounts).to.have.property('results');
      expect(response.body.accounts.results).to.be.an('array');
      expect(response.body.accounts.results).to.have.length(0);
      expect(response.body.accounts).to.have.property('total');
      expect(response.body.accounts.total).to.equal(0);
      
      // Check releases
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.have.property('results');
      expect(response.body.releases.results).to.be.an('array');
      expect(response.body.releases.results).to.have.length(0);
      expect(response.body.releases).to.have.property('total');
      expect(response.body.releases.total).to.equal(0);
      
      // Check hubs
      expect(response.body).to.have.property('hubs');
      expect(response.body.hubs).to.have.property('results');
      expect(response.body.hubs.results).to.be.an('array');
      expect(response.body.hubs.results).to.have.length(0);
      expect(response.body.hubs).to.have.property('total');
      expect(response.body.hubs.total).to.equal(0);
      
      // Check tags
      expect(response.body).to.have.property('tags');
      expect(response.body.tags).to.have.property('results');
      expect(response.body.tags.results).to.be.an('array');
      expect(response.body.tags.results).to.have.length(0);
      expect(response.body.tags).to.have.property('total');
      expect(response.body.tags.total).to.equal(0);
      
      // Check query
      expect(response.body).to.have.property('query');
      expect(response.body.query).to.equal(bogusQuery);
    });

    it('should handle no results for /search/all with bogus query and posts included', async function() {
      const bogusQuery = 'x1y2z3a4b5c6d7e8f9g0h1i2j3k4l5m6n7o8p9q0r1s2t3u4v5w6';
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/search/all?query=${bogusQuery}&includePosts=true`);
      
      expect(response.status).to.equal(200);
      
      // Check all previous properties
      expect(response.body).to.have.property('accounts');
      expect(response.body.accounts.results).to.have.length(0);
      expect(response.body.accounts.total).to.equal(0);
      
      expect(response.body).to.have.property('releases');
      expect(response.body.releases.results).to.have.length(0);
      expect(response.body.releases.total).to.equal(0);
      
      expect(response.body).to.have.property('hubs');
      expect(response.body.hubs.results).to.have.length(0);
      expect(response.body.hubs.total).to.equal(0);
      
      expect(response.body).to.have.property('tags');
      expect(response.body.tags.results).to.have.length(0);
      expect(response.body.tags.total).to.equal(0);
      
      // Check posts specifically
      expect(response.body).to.have.property('posts');
      expect(response.body.posts).to.have.property('results');
      expect(response.body.posts.results).to.be.an('array');
      expect(response.body.posts.results).to.have.length(0);
      expect(response.body.posts).to.have.property('total');
      expect(response.body.posts.total).to.equal(0);
      
      // Check query
      expect(response.body).to.have.property('query');
      expect(response.body.query).to.equal(bogusQuery);
    });

    it('should return tags sorted by popularity (count) in search results', async function() {
      const query = 'music'; // Using a common tag term
      const response = await request(process.env.MOCHA_ENDPOINT_URL)
        .get(`/v1/search/all?query=${query}`);
      
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('tags');
      expect(response.body.tags).to.have.property('results');
      expect(response.body.tags.results).to.be.an('array');
      
      // If we have tags in the results
      if (response.body.tags.results.length > 0) {
        // Verify each tag has a count property
        response.body.tags.results.forEach(tag => {
          expect(tag).to.have.property('count');
          expect(tag.count).to.be.a('number');
        });

        // Verify tags are sorted by count in descending order
        for (let i = 0; i < response.body.tags.results.length - 1; i++) {
          const currentTag = response.body.tags.results[i];
          const nextTag = response.body.tags.results[i + 1];
          expect(currentTag.count).to.be.at.least(nextTag.count);
        }
      }
    });
  });
});