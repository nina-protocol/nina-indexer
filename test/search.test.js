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
});