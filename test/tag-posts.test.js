import request from 'supertest';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { it } from 'mocha';
import {
  Post,
  Tag,
  connectDb,
} from '@nina-protocol/nina-db';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('Tag Posts API Tests', async function() {
  before(async function() {
    await connectDb();
  });

  describe('GET /tags', async function() {
    it('should return tags with release counts', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get('/v1/tags');
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('tags');
      expect(response.body.tags).to.be.an('object');
      expect(response.body.tags).to.have.property('results');
      expect(response.body.tags.results).to.be.an('array');
      expect(response.body.tags).to.have.property('total');
      expect(response.body.tags.total).to.be.a('number');
    });

    it('should return tags with fuzzy search', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get('/v1/tags?query=elec&type=fuzzy');
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('tags');
      expect(response.body.tags.results).to.be.an('array');
    });
  });

  describe('GET /tags/:value', async function() {
    it('should return both releases and posts for a tag', async function() {
      // Using a common tag that likely has content
      const tagValue = 'electronic';
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}`);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('releases');
      expect(response.body.releases).to.be.an('array');
      expect(response.body).to.have.property('posts');
      expect(response.body.posts).to.be.an('array');
      expect(response.body).to.have.property('total');
      expect(response.body.total).to.be.a('number');
      expect(response.body).to.have.property('totalPosts');
      expect(response.body.totalPosts).to.be.a('number');
    });

    it('should return 404 for non-existent tag', async function() {
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get('/v1/tags/nonexistenttag12345xyz');
      expect(response.status).to.equal(404);
      expect(response.body).to.have.property('success');
      expect(response.body.success).to.equal(false);
    });

    it('should support pagination for releases and posts', async function() {
      const tagValue = 'electronic';
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?offset=0&limit=5`);

      expect(response.status).to.equal(200);
      expect(response.body.releases.length).to.be.at.most(5);
      expect(response.body.posts.length).to.be.at.most(5);
    });

    it('should support sorting by datetime', async function() {
      const tagValue = 'electronic';
      const responseDesc = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?sort=desc&column=datetime`);
      const responseAsc = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?sort=asc&column=datetime`);

      expect(responseDesc.status).to.equal(200);
      expect(responseAsc.status).to.equal(200);

      // Verify sorting is working - first item in desc should be newer than first in asc
      if (responseDesc.body.releases.length > 0 && responseAsc.body.releases.length > 0) {
        const descFirst = new Date(responseDesc.body.releases[0].datetime);
        const ascFirst = new Date(responseAsc.body.releases[0].datetime);
        expect(descFirst.getTime()).to.be.at.least(ascFirst.getTime());
      }
    });

    it('should support sorting by favorites', async function() {
      const tagValue = 'electronic';
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?column=favorites&sort=desc`);

      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('releases');
      expect(response.body).to.have.property('posts');
    });

    it('should format releases correctly in response', async function() {
      const tagValue = 'electronic';
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?limit=1`);

      if (response.body.releases.length > 0) {
        const release = response.body.releases[0];
        expect(release).to.have.property('publicKey');
        expect(release).to.not.have.property('id');
        expect(release).to.not.have.property('publisherId');
      }
    });

    it('should format posts correctly in response', async function() {
      const tagValue = 'electronic';
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/tags/${tagValue}?limit=1`);

      if (response.body.posts.length > 0) {
        const post = response.body.posts[0];
        expect(post).to.have.property('publicKey');
        expect(post).to.not.have.property('id');
        expect(post).to.not.have.property('publisherId');
      }
    });
  });

  describe('Tag-Post Model Relationship', async function() {
    it('should be able to query tags for a post via relation', async function() {
      // Find a post that has tags
      const postsWithTags = await Post.query()
        .whereRaw("data->'tags' IS NOT NULL")
        .limit(1);

      if (postsWithTags.length > 0) {
        const post = postsWithTags[0];
        const tags = await post.$relatedQuery('tags');
        expect(tags).to.be.an('array');
      }
    });

    it('should be able to query posts for a tag via relation', async function() {
      // Find a tag that exists
      const tag = await Tag.query().first();

      if (tag) {
        const posts = await tag.$relatedQuery('posts').where('posts.archived', false);
        expect(posts).to.be.an('array');
      }
    });
  });
});
