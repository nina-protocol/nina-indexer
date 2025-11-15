/**
 * Script to backfill missing tag_releases associations for all releases
 * This fixes releases that have tags in metadata but are missing tag_releases associations
 */

import "dotenv/config.js";
import { connectDb, Release, Tag } from '@nina-protocol/nina-db';
import knex from 'knex';
import knexConfig from './db/src/knexfile.js';

const db = knex(knexConfig.development);

async function backfillTagReleases() {
  console.log('🔄 Starting backfill of missing tag_releases associations\n');
  
  // Sanity check: Print environment configuration
  console.log('📋 Environment Configuration:');
  console.log('='.repeat(60));
  console.log(`   POSTGRES_HOST: ${process.env.POSTGRES_HOST || '❌ NOT SET'}`);
  console.log(`   POSTGRES_DATABASE: ${process.env.POSTGRES_DATABASE || '❌ NOT SET'}`);
  console.log(`   POSTGRES_USER: ${process.env.POSTGRES_USER || '❌ NOT SET'}`);
  console.log(`   POSTGRES_PASSWORD: ${process.env.POSTGRES_PASSWORD ? '✅ SET (' + process.env.POSTGRES_PASSWORD.substring(0, 3) + '***)' : '❌ NOT SET'}`);
  console.log('='.repeat(60));
  console.log('\n⏸️  Please verify the above configuration before proceeding...\n');
  
  // Give a moment to review (or remove this if you want it to continue immediately)
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Configuration for error handling
  const MAX_CONSECUTIVE_ERRORS = 10; // Abort if we get this many consecutive errors
  const MAX_ERROR_RATE = 0.5; // Abort if error rate exceeds 50%
  let consecutiveErrors = 0;
  let totalErrors = 0;
  
  try {
    // Connect to database
    await connectDb();
    console.log('✅ Connected to database\n');
    
    // Test database connection with a simple query
    try {
      await db.raw('SELECT 1');
      console.log('✅ Database connection verified\n');
    } catch (connError) {
      console.error('❌ Database connection test failed:', connError.message);
      throw new Error('Cannot proceed - database connection is not working');
    }

    // Find all releases that have tags in metadata
    console.log('📋 Finding all releases with tags in metadata...\n');
    
    // Query releases with tags - filter empty arrays in JavaScript for compatibility
    const releasesWithTags = await db.raw(`
      SELECT 
        r.id,
        r."publicKey",
        r.slug,
        r.datetime,
        r.metadata->'properties'->'tags' as metadata_tags,
        r.metadata
      FROM releases r
      WHERE r.archived = false
        AND r.metadata->'properties'->'tags' IS NOT NULL
      ORDER BY r.datetime ASC
    `);

    // Filter out releases with empty or invalid tag arrays in JavaScript
    const releases = releasesWithTags.rows.filter(release => {
      const tags = release.metadata_tags;
      return Array.isArray(tags) && tags.length > 0;
    });
    
    if (releases.length === 0) {
      console.log('ℹ️  No releases found with tags in metadata');
      return;
    }

    console.log(`Found ${releases.length} releases with tags in metadata\n`);

    let examinedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const release of releases) {
      examinedCount++;
      
      try {
        const metadataTags = release.metadata_tags || [];
        // Filter to only valid string tags
        const validTags = metadataTags.filter(t => t && typeof t === 'string');

        if (validTags.length === 0) {
          skippedCount++;
          consecutiveErrors = 0; // Reset on successful skip
          // Progress indicator
          if (examinedCount % 50 === 0) {
            console.log(`\n📊 Progress: ${examinedCount}/${releases.length} releases examined\n`);
          }
          continue;
        }

        // Get existing tags for this release
        const existingTags = await Release.relatedQuery("tags")
          .for(release.id);
        const existingTagValues = existingTags.map(t => t.value.toLowerCase());

        // Find missing tags by comparing sanitized values
        // Note: Tag.sanitizeValue() already lowercases, and tags in DB are stored lowercase
        const missingTags = validTags.filter(tag => {
          const sanitized = Tag.sanitizeValue(tag);
          return !existingTagValues.includes(sanitized);
        });

        if (missingTags.length === 0) {
          skippedCount++;
          consecutiveErrors = 0; // Reset on successful skip
          // Progress indicator
          if (examinedCount % 50 === 0) {
            console.log(`\n📊 Progress: ${examinedCount}/${releases.length} releases examined\n`);
          }
          continue;
        }

        // Create missing tag associations
        let tagsCreated = 0;
        let tagsFailed = 0;
        for (const tagValue of missingTags) {
          try {
            // Tag.findOrCreate expects the original tag value and sanitizes internally
            const tagRecord = await Tag.findOrCreate(tagValue);
            await Release.relatedQuery("tags")
              .for(release.id)
              .relate(tagRecord.id)
              .onConflict(["tagId", "releaseId"])
              .ignore();
            tagsCreated++;
          } catch (tagError) {
            tagsFailed++;
            console.error(`  ⚠️  Error adding tag "${tagValue}" to release ${release.publicKey}:`, tagError.message);
            errors.push({
              release: release.publicKey,
              tag: tagValue,
              error: tagError.message
            });
          }
        }

        if (tagsCreated > 0) {
          createdCount++;
          console.log(`✅ Release: ${release.publicKey} (${release.slug})`);
          console.log(`   Added ${tagsCreated} missing tag(s): ${missingTags.join(', ')}`);
          if (tagsFailed > 0) {
            console.log(`   ⚠️  ${tagsFailed} tag(s) failed to create (see errors above)`);
          }
          // Reset consecutive errors on successful tag creation
          consecutiveErrors = 0;
        } else if (tagsFailed > 0) {
          // All tag creations failed - count as error for verification purposes
          errorCount++;
          totalErrors++;
          consecutiveErrors++;
          console.log(`⚠️  Release: ${release.publicKey} (${release.slug}) - All ${tagsFailed} tag(s) failed to create`);
        } else {
          // No tags to create, but processing was successful
          consecutiveErrors = 0;
        }

        // Progress indicator
        if (examinedCount % 50 === 0) {
          console.log(`\n📊 Progress: ${examinedCount}/${releases.length} releases examined\n`);
        }

      } catch (error) {
        errorCount++;
        totalErrors++;
        consecutiveErrors++;
        console.error(`❌ Error processing release ${release.publicKey}:`, error.message);
        errors.push({
          release: release.publicKey,
          error: error.message
        });
        
        // Check if this is a critical database error
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
        
        // Check for too many consecutive errors
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`\n💥 Too many consecutive errors (${consecutiveErrors})!`);
          console.error('   Aborting to prevent data corruption...');
          throw new Error(`Aborted due to ${consecutiveErrors} consecutive errors`);
        }
        
        // Check error rate (only after processing enough releases to have meaningful stats)
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
    console.log(`   Total releases examined: ${examinedCount}`);
    console.log(`   ✅ Releases with tags created: ${createdCount}`);
    console.log(`   ⏭️  Releases skipped (no tags or tags already exist): ${skippedCount}`);
    console.log(`   ❌ Releases with errors: ${errorCount}`);
    
    // Verification: all releases should be accounted for
    const totalAccounted = skippedCount + createdCount + errorCount;
    const verificationMatch = examinedCount === totalAccounted;
    console.log(`   ✅ Verification: ${verificationMatch ? '✓ Counts match' : `✗ Count mismatch! (${examinedCount} examined vs ${totalAccounted} accounted)`}`);
    console.log('='.repeat(60));

    if (errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. Release: ${err.release}`);
        if (err.tag) {
          console.log(`      Tag: ${err.tag}`);
        }
        console.log(`      Error: ${err.error}`);
      });
    }

    if (createdCount > 0) {
      console.log(`\n✅ Successfully created ${createdCount} tag associations!`);
    } else {
      console.log('\nℹ️  No missing tag associations found - all releases already have their tags.');
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
backfillTagReleases()
  .then(() => {
    console.log('\n✨ Backfill completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Backfill failed:', error);
    process.exit(1);
  });

