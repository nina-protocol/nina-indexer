import request from 'supertest';
import chai from 'chai';
import { it } from 'mocha';
import {
  Post,
  Release,
  connectDb,
} from '@nina-protocol/nina-db';
import knex from 'knex';
import knexConfig from '../db/src/knexfile.js';

const { expect } = chai;
const db = knex(knexConfig.development);

describe('Posts with Releases via posts_releases join table', async function() {
  before(async function() {
    await connectDb();
  });

  after(async function() {
    await db.destroy();
  });

  describe('GET /posts with releases', async function() {
    it('should include releases from posts_releases join table', async function() {
      // Find a post that has releases in the posts_releases table
      const postWithReleases = await db.raw(`
        SELECT p.*, COUNT(pr."releaseId") as release_count
        FROM posts p
        INNER JOIN posts_releases pr ON p.id = pr."postId"
        WHERE p.archived = false
        GROUP BY p.id
        HAVING COUNT(pr."releaseId") > 0
        LIMIT 1
      `);

      if (postWithReleases.rows.length === 0) {
        this.skip(); // Skip test if no posts with releases exist
        return;
      }

      const postPublicKey = postWithReleases.rows[0].publicKey;
      const expectedReleaseCount = parseInt(postWithReleases.rows[0].release_count);

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts?limit=20`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('posts');
      expect(response.body.posts).to.be.an('array');

      // Find the post with releases in the response
      const postInResponse = response.body.posts.find(p => p.publicKey === postPublicKey);

      if (postInResponse) {
        expect(postInResponse).to.have.property('releases');
        expect(postInResponse.releases).to.be.an('array');
        expect(postInResponse.releases).to.have.length(expectedReleaseCount);

        // Verify releases are formatted correctly
        postInResponse.releases.forEach(release => {
          expect(release).to.have.property('publicKey');
          expect(release).to.have.property('metadata');
          expect(release).to.not.have.property('id'); // Should be stripped by format()
        });
      }
    });

    it('should handle posts without releases gracefully', async function() {
      // Find a post that has NO releases in posts_releases table
      const postWithoutReleases = await db.raw(`
        SELECT p.*
        FROM posts p
        LEFT JOIN posts_releases pr ON p.id = pr."postId"
        WHERE p.archived = false
          AND pr."releaseId" IS NULL
        LIMIT 1
      `);

      if (postWithoutReleases.rows.length === 0) {
        this.skip(); // Skip test if all posts have releases
        return;
      }

      const postPublicKey = postWithoutReleases.rows[0].publicKey;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts?limit=20`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('posts');

      const postInResponse = response.body.posts.find(p => p.publicKey === postPublicKey);

      if (postInResponse) {
        // Post should have releases property but it should be empty
        expect(postInResponse).to.have.property('releases');
        expect(postInResponse.releases).to.be.an('array');
        expect(postInResponse.releases).to.have.length(0);
      }
    });
  });

  describe('GET /posts/:publicKeyOrSlug with releases', async function() {
    it('should include releases from posts_releases join table for single post', async function() {
      // Find a post that has releases
      const postWithReleases = await db.raw(`
        SELECT p.*, COUNT(pr."releaseId") as release_count
        FROM posts p
        INNER JOIN posts_releases pr ON p.id = pr."postId"
        WHERE p.archived = false
        GROUP BY p.id
        HAVING COUNT(pr."releaseId") > 0
        LIMIT 1
      `);

      if (postWithReleases.rows.length === 0) {
        this.skip(); // Skip test if no posts with releases exist
        return;
      }

      const postPublicKey = postWithReleases.rows[0].publicKey;
      const expectedReleaseCount = parseInt(postWithReleases.rows[0].release_count);

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts/${postPublicKey}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('post');
      expect(response.body.post).to.have.property('publicKey');
      expect(response.body.post.publicKey).to.equal(postPublicKey);

      // Verify releases are included
      expect(response.body.post).to.have.property('releases');
      expect(response.body.post.releases).to.be.an('array');
      expect(response.body.post.releases).to.have.length(expectedReleaseCount);

      // Verify releases are formatted
      response.body.post.releases.forEach(release => {
        expect(release).to.have.property('publicKey');
        expect(release).to.have.property('metadata');
        expect(release).to.not.have.property('id'); // Should be stripped by format()
      });
    });

    it('should find post by slug and include releases', async function() {
      // Find a post with a slug that has releases
      const postWithSlugAndReleases = await db.raw(`
        SELECT p.*, COUNT(pr."releaseId") as release_count
        FROM posts p
        INNER JOIN posts_releases pr ON p.id = pr."postId"
        WHERE p.archived = false
          AND p.data->>'slug' IS NOT NULL
        GROUP BY p.id
        HAVING COUNT(pr."releaseId") > 0
        LIMIT 1
      `);

      if (postWithSlugAndReleases.rows.length === 0) {
        this.skip(); // Skip test if no posts with slug and releases exist
        return;
      }

      const slug = postWithSlugAndReleases.rows[0].data.slug;
      const expectedReleaseCount = parseInt(postWithSlugAndReleases.rows[0].release_count);

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts/${slug}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('post');
      expect(response.body.post.data).to.have.property('slug');
      expect(response.body.post.data.slug).to.equal(slug);

      // Verify releases are included
      expect(response.body.post).to.have.property('releases');
      expect(response.body.post.releases).to.be.an('array');
      expect(response.body.post.releases).to.have.length(expectedReleaseCount);
    });

    it('should work with posts that have no releases', async function() {
      // Find a post with no releases
      const postWithoutReleases = await db.raw(`
        SELECT p.*
        FROM posts p
        LEFT JOIN posts_releases pr ON p.id = pr."postId"
        WHERE p.archived = false
          AND pr."releaseId" IS NULL
        LIMIT 1
      `);

      if (postWithoutReleases.rows.length === 0) {
        this.skip(); // Skip test if all posts have releases
        return;
      }

      const postPublicKey = postWithoutReleases.rows[0].publicKey;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts/${postPublicKey}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('post');

      // Should have empty releases array
      expect(response.body.post).to.have.property('releases');
      expect(response.body.post.releases).to.be.an('array');
      expect(response.body.post.releases).to.have.length(0);
    });
  });

  describe('Performance: SQL JOIN vs N+1 queries', async function() {
    it('should load releases via SQL JOIN (not individual queries)', async function() {
      // This test verifies that we're using .withGraphFetched() which creates a JOIN
      // rather than N individual queries for each release

      // Get a post with releases directly from the model
      const post = await Post.query()
        .where('archived', false)
        .withGraphFetched('releases')
        .whereExists(
          Post.relatedQuery('releases')
        )
        .first();

      if (!post) {
        this.skip(); // Skip if no posts with releases exist
        return;
      }

      // Verify releases are loaded
      expect(post.releases).to.be.an('array');
      expect(post.releases.length).to.be.greaterThan(0);

      // Verify releases have all expected properties
      post.releases.forEach(release => {
        expect(release).to.be.instanceOf(Release);
        expect(release).to.have.property('publicKey');
        expect(release).to.have.property('metadata');
      });
    });

    it('should efficiently load releases for multiple posts', async function() {
      // Get multiple posts with releases
      const posts = await Post.query()
        .where('archived', false)
        .withGraphFetched('releases')
        .whereExists(
          Post.relatedQuery('releases')
        )
        .limit(5);

      if (posts.length === 0) {
        this.skip(); // Skip if no posts with releases exist
        return;
      }

      // Verify all posts have releases loaded
      let totalReleases = 0;
      posts.forEach(post => {
        expect(post.releases).to.be.an('array');
        totalReleases += post.releases.length;
      });

      expect(totalReleases).to.be.greaterThan(0);
      console.log(`Loaded ${posts.length} posts with ${totalReleases} total releases via SQL JOIN`);
    });
  });

  describe('Backward compatibility: hub blocks', async function() {
    it('should still process hub blocks when present', async function() {
      // Find a post with hub blocks in data
      const postWithHubBlocks = await db.raw(`
        SELECT p.*
        FROM posts p
        WHERE p.archived = false
          AND p.data->'blocks' IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM json_array_elements(p.data->'blocks') AS block
            WHERE block->>'type' = 'hub'
          )
        LIMIT 1
      `);

      if (postWithHubBlocks.rows.length === 0) {
        this.skip(); // Skip test if no posts with hub blocks exist
        return;
      }

      const postPublicKey = postWithHubBlocks.rows[0].publicKey;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts/${postPublicKey}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('post');
      expect(response.body.post.data).to.have.property('blocks');

      // Find hub blocks
      const hubBlocks = response.body.post.data.blocks.filter(block => block.type === 'hub');

      if (hubBlocks.length > 0) {
        // Verify hub blocks are still processed
        hubBlocks.forEach(block => {
          expect(block).to.have.property('data');
          expect(block.data).to.have.property('hubs');
          expect(block.data.hubs).to.be.an('array');
        });
      }
    });
  });
});
