#!/usr/bin/env node

/**
 * Clear CSV jobs directly using Redis commands
 * This bypasses Bull queue connection issues
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Redis = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10)
};

async function clearCSVJobs() {
  let redis;
  
  try {
    console.log('📡 Connecting to Redis...');
    redis = new Redis(redisConfig);

    await redis.ping();
    console.log('✅ Connected to Redis');

    // Bull queue keys pattern: bull:csv-generation:*
    const queueKeyPattern = 'bull:csv-generation:*';
    
    console.log('\n🔍 Finding CSV job keys...');
    const keys = await redis.keys(queueKeyPattern);
    
    console.log(`   Found ${keys.length} keys matching pattern`);
    
    if (keys.length === 0) {
      console.log('\n✅ No CSV jobs found in queue');
      await redis.quit();
      process.exit(0);
    }

    // Group keys by type (more flexible matching)
    const waitingKeys = keys.filter(k => k.includes(':wait') || k.includes(':waiting'));
    const activeKeys = keys.filter(k => k.includes(':active') && !k.includes(':meta'));
    const delayedKeys = keys.filter(k => k.includes(':delayed'));
    const completedKeys = keys.filter(k => k.includes(':completed'));
    const failedKeys = keys.filter(k => k.includes(':failed'));
    
    // Also get job IDs from lists/sets
    const activeJobIds = await redis.lrange('bull:csv-generation:active', 0, -1).catch(() => []);
    const waitingJobIds = await redis.lrange('bull:csv-generation:wait', 0, -1).catch(() => []);
    const delayedJobIds = await redis.zrange('bull:csv-generation:delayed', 0, -1).catch(() => []);

    console.log(`\n📊 Job breakdown:`);
    console.log(`   Waiting: ${waitingKeys.length} (${waitingJobIds.length} in list)`);
    console.log(`   Active: ${activeKeys.length} (${activeJobIds.length} in list)`);
    console.log(`   Delayed: ${delayedKeys.length} (${delayedJobIds.length} in set)`);
    console.log(`   Completed: ${completedKeys.length}`);
    console.log(`   Failed: ${failedKeys.length}`);

    let removedCount = 0;

    // Remove waiting jobs
    if (waitingKeys.length > 0) {
      console.log(`\n🗑️  Removing ${waitingKeys.length} waiting jobs...`);
      for (const key of waitingKeys) {
        await redis.del(key);
        removedCount++;
      }
      console.log(`   ✅ Removed ${waitingKeys.length} waiting jobs`);
    }

    // Remove active jobs
    if (activeKeys.length > 0) {
      console.log(`\n🗑️  Removing ${activeKeys.length} active jobs...`);
      for (const key of activeKeys) {
        await redis.del(key);
        removedCount++;
      }
      console.log(`   ✅ Removed ${activeKeys.length} active jobs`);
    }

    // Remove delayed jobs
    if (delayedKeys.length > 0) {
      console.log(`\n🗑️  Removing ${delayedKeys.length} delayed jobs...`);
      for (const key of delayedKeys) {
        await redis.del(key);
        removedCount++;
      }
      console.log(`   ✅ Removed ${delayedKeys.length} delayed jobs`);
    }

    // Remove failed jobs
    if (failedKeys.length > 0) {
      console.log(`\n🗑️  Removing ${failedKeys.length} failed jobs...`);
      for (const key of failedKeys) {
        await redis.del(key);
        removedCount++;
      }
      console.log(`   ✅ Removed ${failedKeys.length} failed jobs`);
    }

    // Also clear the main queue lists (check type first)
    const queueLists = [
      'bull:csv-generation:wait',
      'bull:csv-generation:active',
      'bull:csv-generation:delayed',
      'bull:csv-generation:completed',
      'bull:csv-generation:failed'
    ];

    console.log(`\n🗑️  Clearing queue lists...`);
    for (const listKey of queueLists) {
      try {
        const type = await redis.type(listKey);
        if (type === 'list') {
          const length = await redis.llen(listKey);
          if (length > 0) {
            await redis.del(listKey);
            console.log(`   ✅ Cleared ${listKey} (${length} items)`);
          }
        } else if (type === 'zset') {
          // Delayed/completed/failed are sorted sets
          const length = await redis.zcard(listKey);
          if (length > 0) {
            await redis.del(listKey);
            console.log(`   ✅ Cleared ${listKey} (${length} items)`);
          }
        }
      } catch (error) {
        // Skip if key doesn't exist or wrong type
        console.log(`   ⚠️  Skipped ${listKey}: ${error.message}`);
      }
    }

    console.log(`\n✅ Cleanup complete! Removed ${removedCount} job keys total`);
    
    // Verify cleanup
    const remainingKeys = await redis.keys(queueKeyPattern);
    console.log(`\n📊 Remaining keys: ${remainingKeys.length}`);
    
    if (remainingKeys.length === 0) {
      console.log('\n✅ Queue is now empty - ready for fresh jobs!');
    } else {
      console.log(`\n⚠️  ${remainingKeys.length} keys still remain (may be metadata)`);
    }

    await redis.quit();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error clearing CSV jobs:', error.message);
    if (redis) {
      await redis.quit().catch(() => {});
    }
    process.exit(1);
  }
}

// Run the script
clearCSVJobs();

