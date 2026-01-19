/**
 * Script to backfill posts_releases table:
 * 1. Update created_at for existing posts_releases records from post datetime
 * 2. Scan all posts and create posts_releases records for release blocks in post data
 *    - 'release' blocks: block.data is an array of objects with publicKey property
 *    - 'featuredRelease' blocks: block.data is the publicKey string directly
 */

import "dotenv/config.js";
import { connectDb, Post, Release } from '@nina-protocol/nina-db';
import knex from 'knex';
import knexConfig from './db/src/knexfile.js';

const db = knex(knexConfig.development);

async function backfillPostsReleases() {
  console.log('Starting backfill of posts_releases timestamps\n');

  // Sanity check: Print environment configuration
  console.log('Environment Configuration:');
  console.log('='.repeat(60));
  console.log(`   POSTGRES_HOST: ${process.env.POSTGRES_HOST || 'NOT SET'}`);
  console.log(`   POSTGRES_DATABASE: ${process.env.POSTGRES_DATABASE || 'NOT SET'}`);
  console.log(`   POSTGRES_USER: ${process.env.POSTGRES_USER || 'NOT SET'}`);
  console.log(`   POSTGRES_PASSWORD: ${process.env.POSTGRES_PASSWORD ? 'SET (' + process.env.POSTGRES_PASSWORD.substring(0, 3) + '***)' : 'NOT SET'}`);
  console.log('='.repeat(60));
  console.log('\nPlease verify the above configuration before proceeding...\n');

  // Give a moment to review
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Configuration for error handling
  const MAX_CONSECUTIVE_ERRORS = 10;
  const MAX_ERROR_RATE = 0.5;
  let consecutiveErrors = 0;
  let totalErrors = 0;

  try {
    // Connect to database
    await connectDb();
    console.log('Connected to database\n');

    // Test database connection
    try {
      await db.raw('SELECT 1');
      console.log('Database connection verified\n');
    } catch (connError) {
      console.error('Database connection test failed:', connError.message);
      throw new Error('Cannot proceed - database connection is not working');
    }

    // =====================================================
    // PART 1: Update created_at for existing posts_releases
    // =====================================================
    console.log('='.repeat(60));
    console.log('PART 1: Updating created_at for existing posts_releases records');
    console.log('='.repeat(60));

    // Get all existing posts_releases and join with posts to get datetime
    const existingRecords = await db.raw(`
      SELECT
        pr."postId",
        pr."releaseId",
        p.datetime as post_datetime,
        p.version as post_version
      FROM posts_releases pr
      JOIN posts p ON p.id = pr."postId"
      WHERE pr.created_at IS NULL
    `);

    console.log(`Found ${existingRecords.rows.length} posts_releases records to update\n`);

    let updatedCount = 0;
    let updateErrors = 0;

    for (const record of existingRecords.rows) {
      try {
        await db('posts_releases')
          .where({ postId: record.postId, releaseId: record.releaseId })
          .update({ created_at: record.post_datetime });
        updatedCount++;
        consecutiveErrors = 0;

        if (updatedCount % 100 === 0) {
          console.log(`Progress: ${updatedCount}/${existingRecords.rows.length} records updated`);
        }
      } catch (error) {
        updateErrors++;
        totalErrors++;
        consecutiveErrors++;
        console.error(`Error updating record (postId: ${record.postId}, releaseId: ${record.releaseId}):`, error.message);

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Aborted due to ${consecutiveErrors} consecutive errors`);
        }
      }
    }

    console.log(`\nPart 1 Summary:`);
    console.log(`   Records updated: ${updatedCount}`);
    console.log(`   Errors: ${updateErrors}\n`);

    // =====================================================
    // PART 2: Scan all posts and create missing posts_releases
    // =====================================================
    console.log('='.repeat(60));
    console.log('PART 2: Scanning all posts for release blocks');
    console.log('='.repeat(60));

    // Find all posts
    const allPosts = await db.raw(`
      SELECT
        p.id,
        p."publicKey",
        p.data,
        p.datetime,
        p.version
      FROM posts p
      WHERE p.archived = false
      ORDER BY p.datetime ASC
    `);

    console.log(`Found ${allPosts.rows.length} posts to examine\n`);

    let examinedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const post of allPosts.rows) {
      examinedCount++;

      try {
        const blocks = post.data?.blocks;

        if (!blocks || !Array.isArray(blocks)) {
          skippedCount++;
          consecutiveErrors = 0;
          continue;
        }

        // Find all release-related blocks
        const releaseBlocks = blocks.filter(block =>
          block.type === 'release' || block.type === 'featuredRelease'
        );

        if (releaseBlocks.length === 0) {
          skippedCount++;
          consecutiveErrors = 0;
          if (examinedCount % 100 === 0) {
            console.log(`Progress: ${examinedCount}/${allPosts.rows.length} posts examined`);
          }
          continue;
        }

        for (const block of releaseBlocks) {
          // Extract release public keys based on block type
          let releasePublicKeys = [];

          if (block.type === 'release') {
            // 'release' blocks have data as an array of objects with publicKey
            if (Array.isArray(block.data)) {
              releasePublicKeys = block.data
                .map(item => item?.publicKey || (typeof item === 'string' ? item : null))
                .filter(Boolean);
            }
          } else if (block.type === 'featuredRelease') {
            // 'featuredRelease' blocks have data as the publicKey string directly
            const pk = typeof block.data === 'string' ? block.data : block.data?.publicKey;
            if (pk) {
              releasePublicKeys = [pk];
            }
          }

          for (const releasePublicKey of releasePublicKeys) {
            try {
              // Find the release record
              const releaseRecord = await Release.query().findOne({ publicKey: releasePublicKey });

              if (!releaseRecord) {
                // Release may not exist in DB yet - skip silently
                continue;
              }

              // Check if the relationship already exists
              const existingRelation = await db('posts_releases')
                .where({ postId: post.id, releaseId: releaseRecord.id })
                .first();

              if (existingRelation) {
                // Update created_at if not set
                if (!existingRelation.created_at) {
                  await db('posts_releases')
                    .where({ postId: post.id, releaseId: releaseRecord.id })
                    .update({ created_at: post.datetime });
                }
                continue;
              }

              // Create new posts_releases record
              await db('posts_releases').insert({
                postId: post.id,
                releaseId: releaseRecord.id,
                created_at: post.datetime
              });

              createdCount++;
              console.log(`Created posts_releases: post ${post.publicKey} -> release ${releasePublicKey} (${block.type})`);

            } catch (blockError) {
              console.error(`  Error processing ${block.type} block:`, blockError.message);
              errors.push({
                post: post.publicKey,
                release: releasePublicKey,
                blockType: block.type,
                error: blockError.message
              });
            }
          }
        }

        consecutiveErrors = 0;

        if (examinedCount % 100 === 0) {
          console.log(`Progress: ${examinedCount}/${allPosts.rows.length} posts examined`);
        }

      } catch (error) {
        errorCount++;
        totalErrors++;
        consecutiveErrors++;
        console.error(`Error processing post ${post.publicKey}:`, error.message);
        errors.push({
          post: post.publicKey,
          error: error.message
        });

        // Check for critical database errors
        const isCriticalError = error.message.includes('connection') ||
                                error.message.includes('ECONNREFUSED') ||
                                error.message.includes('timeout') ||
                                error.message.includes('Connection terminated');

        if (isCriticalError) {
          console.error('\nCRITICAL DATABASE ERROR DETECTED!');
          throw new Error(`Critical database error: ${error.message}`);
        }

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          throw new Error(`Aborted due to ${consecutiveErrors} consecutive errors`);
        }

        if (examinedCount > 10) {
          const errorRate = totalErrors / examinedCount;
          if (errorRate > MAX_ERROR_RATE) {
            throw new Error(`Aborted due to high error rate: ${(errorRate * 100).toFixed(1)}%`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Summary:');
    console.log('='.repeat(60));
    console.log(`Part 1 - Existing records updated: ${updatedCount}`);
    console.log(`Part 2 - Posts examined: ${examinedCount}`);
    console.log(`Part 2 - New posts_releases created: ${createdCount}`);
    console.log(`Part 2 - Posts skipped (no release blocks): ${skippedCount}`);
    console.log(`Part 2 - Errors: ${errorCount}`);
    console.log('='.repeat(60));

    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. Post: ${err.post}`);
        if (err.release) {
          console.log(`      Release: ${err.release}`);
        }
        if (err.blockType) {
          console.log(`      Block type: ${err.blockType}`);
        }
        console.log(`      Error: ${err.error}`);
      });
    }

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('FATAL ERROR - Backfill aborted!');
    console.error('='.repeat(60));
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error('='.repeat(60));
    throw error;
  } finally {
    try {
      await db.destroy();
      console.log('\nDatabase connection closed');
    } catch (closeError) {
      console.error('Error closing database connection:', closeError.message);
    }
  }
}

// Run the backfill
backfillPostsReleases()
  .then(() => {
    console.log('\nBackfill completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nBackfill failed:', error);
    process.exit(1);
  });
