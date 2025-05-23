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
      
      expect(response.status).to.equal(200);
      
      // ensure results array exists
      expect(response.body).to.have.property('posts');
      expect(response.body.posts).to.be.an('object');
      expect(response.body.posts).to.have.property('results');
      expect(response.body.posts.results).to.be.an('array');
      
      // ensure posts has total
      expect(response.body.posts).to.have.property('total');
      expect(response.body.posts.total).to.be.a('number');
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
  });
});