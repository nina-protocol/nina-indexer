/**
 * Script to backfill missing tags_posts associations for all posts
 * This populates tags_posts for posts that have tags in their data but are missing associations
 */

import "dotenv/config.js";
import { connectDb, Post, Tag } from '@nina-protocol/nina-db';
import knex from 'knex';
import knexConfig from './db/src/knexfile.js';

const db = knex(knexConfig.development);

async function backfillTagPosts() {
  console.log('🔄 Starting backfill of missing tags_posts associations\n');

  // Sanity check: Print environment configuration
  console.log('📋 Environment Configuration:');
  console.log('='.repeat(60));
  console.log(`   POSTGRES_HOST: ${process.env.POSTGRES_HOST || '❌ NOT SET'}`);
  console.log(`   POSTGRES_DATABASE: ${process.env.POSTGRES_DATABASE || '❌ NOT SET'}`);
  console.log(`   POSTGRES_USER: ${process.env.POSTGRES_USER || '❌ NOT SET'}`);
  console.log(`   POSTGRES_PASSWORD: ${process.env.POSTGRES_PASSWORD ? '✅ SET (' + process.env.POSTGRES_PASSWORD.substring(0, 3) + '***)' : '❌ NOT SET'}`);
  console.log('='.repeat(60));
  console.log('\n⏸️  Please verify the above configuration before proceeding...\n');

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
    console.log('✅ Connected to database\n');

    // Test database connection
    try {
      await db.raw('SELECT 1');
      console.log('✅ Database connection verified\n');
    } catch (connError) {
      console.error('❌ Database connection test failed:', connError.message);
      throw new Error('Cannot proceed - database connection is not working');
    }

    // Find all posts that have tags in data
    console.log('📋 Finding all posts with tags in data...\n');

    // Query posts with tags - tags are at data.tags
    const postsWithTags = await db.raw(`
      SELECT
        p.id,
        p."publicKey",
        p.datetime,
        p.data->'tags' as data_tags,
        p.data
      FROM posts p
      WHERE p.archived = false
        AND p.data->'tags' IS NOT NULL
      ORDER BY p.datetime ASC
    `);

    // Filter out posts with empty or invalid tag arrays
    const posts = postsWithTags.rows.filter(post => {
      const tags = post.data_tags;
      return Array.isArray(tags) && tags.length > 0;
    });

    if (posts.length === 0) {
      console.log('ℹ️  No posts found with tags in data');
      return;
    }

    console.log(`Found ${posts.length} posts with tags in data\n`);

    let examinedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const post of posts) {
      examinedCount++;

      try {
        const dataTags = post.data_tags || [];
        // Filter to only valid string tags
        const validTags = dataTags.filter(t => t && typeof t === 'string');

        if (validTags.length === 0) {
          skippedCount++;
          consecutiveErrors = 0;
          if (examinedCount % 50 === 0) {
            console.log(`\n📊 Progress: ${examinedCount}/${posts.length} posts examined\n`);
          }
          continue;
        }

        // Get existing tags for this post
        const existingTags = await Post.relatedQuery("tags")
          .for(post.id);
        const existingTagValues = existingTags.map(t => t.value.toLowerCase());

        // Find missing tags by comparing sanitized values
        const missingTags = validTags.filter(tag => {
          const sanitized = Tag.sanitizeValue(tag);
          return !existingTagValues.includes(sanitized);
        });

        if (missingTags.length === 0) {
          skippedCount++;
          consecutiveErrors = 0;
          if (examinedCount % 50 === 0) {
            console.log(`\n📊 Progress: ${examinedCount}/${posts.length} posts examined\n`);
          }
          continue;
        }

        // Create missing tag associations
        let tagsCreated = 0;
        let tagsFailed = 0;
        for (const tagValue of missingTags) {
          try {
            const tagRecord = await Tag.findOrCreate(tagValue);
            await Post.relatedQuery("tags")
              .for(post.id)
              .relate(tagRecord.id)
              .onConflict(["tagId", "postId"])
              .ignore();
            tagsCreated++;
          } catch (tagError) {
            tagsFailed++;
            console.error(`  ⚠️  Error adding tag "${tagValue}" to post ${post.publicKey}:`, tagError.message);
            errors.push({
              post: post.publicKey,
              tag: tagValue,
              error: tagError.message
            });
          }
        }

        if (tagsCreated > 0) {
          createdCount++;
          console.log(`✅ Post: ${post.publicKey}`);
          console.log(`   Added ${tagsCreated} missing tag(s): ${missingTags.join(', ')}`);
          if (tagsFailed > 0) {
            console.log(`   ⚠️  ${tagsFailed} tag(s) failed to create (see errors above)`);
          }
          consecutiveErrors = 0;
        } else if (tagsFailed > 0) {
          errorCount++;
          totalErrors++;
          consecutiveErrors++;
          console.log(`⚠️  Post: ${post.publicKey} - All ${tagsFailed} tag(s) failed to create`);
        } else {
          consecutiveErrors = 0;
        }

        if (examinedCount % 50 === 0) {
          console.log(`\n📊 Progress: ${examinedCount}/${posts.length} posts examined\n`);
        }

      } catch (error) {
        errorCount++;
        totalErrors++;
        consecutiveErrors++;
        console.error(`❌ Error processing post ${post.publicKey}:`, error.message);
        errors.push({
          post: post.publicKey,
          error: error.message
        });

        const isCriticalError = error.message.includes('connection') ||
                                error.message.includes('ECONNREFUSED') ||
                                error.message.includes('timeout') ||
                                error.message.includes('Connection terminated') ||
                                error.message.includes('Connection lost') ||
                                error.message.includes('database') ||
                                error.message.includes('ECONNRESET');

        if (isCriticalError) {
          console.error('\n💥 CRITICAL DATABASE ERROR DETECTED!');
          console.error('   Aborting to prevent data corruption...');
          throw new Error(`Critical database error: ${error.message}`);
        }

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`\n💥 Too many consecutive errors (${consecutiveErrors})!`);
          console.error('   Aborting to prevent data corruption...');
          throw new Error(`Aborted due to ${consecutiveErrors} consecutive errors`);
        }

        if (examinedCount > 10) {
          const errorRate = totalErrors / examinedCount;
          if (errorRate > MAX_ERROR_RATE) {
            console.error(`\n💥 Error rate too high (${(errorRate * 100).toFixed(1)}% errors)!`);
            console.error('   Aborting to prevent data corruption...');
            throw new Error(`Aborted due to high error rate: ${(errorRate * 100).toFixed(1)}%`);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Summary:');
    console.log('='.repeat(60));
    console.log(`   Total posts examined: ${examinedCount}`);
    console.log(`   ✅ Posts with tags created: ${createdCount}`);
    console.log(`   ⏭️  Posts skipped (no tags or tags already exist): ${skippedCount}`);
    console.log(`   ❌ Posts with errors: ${errorCount}`);

    const totalAccounted = skippedCount + createdCount + errorCount;
    const verificationMatch = examinedCount === totalAccounted;
    console.log(`   ✅ Verification: ${verificationMatch ? '✓ Counts match' : `✗ Count mismatch! (${examinedCount} examined vs ${totalAccounted} accounted)`}`);
    console.log('='.repeat(60));

    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. Post: ${err.post}`);
        if (err.tag) {
          console.log(`      Tag: ${err.tag}`);
        }
        console.log(`      Error: ${err.error}`);
      });
    }

    if (createdCount > 0) {
      console.log(`\n✅ Successfully created ${createdCount} tag associations!`);
    } else {
      console.log('\nℹ️  No missing tag associations found - all posts already have their tags.');
    }

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ FATAL ERROR - Backfill aborted to prevent data corruption!');
    console.error('='.repeat(60));
    console.error(`   Error: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    console.error('='.repeat(60));
    console.error('\n⚠️  The script has been stopped to prevent data corruption.');
    console.error('   Please review the errors above and fix any issues before retrying.');
    throw error;
  } finally {
    try {
      await db.destroy();
      console.log('\n🔌 Database connection closed');
    } catch (closeError) {
      console.error('⚠️  Error closing database connection:', closeError.message);
    }
  }
}

// Run the backfill
backfillTagPosts()
  .then(() => {
    console.log('\n✨ Backfill completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Backfill failed:', error);
    process.exit(1);
  });
