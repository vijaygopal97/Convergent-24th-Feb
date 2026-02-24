#!/usr/bin/env node

/**
 * Clear all CSV generation jobs from the queue
 * This script removes all waiting, active, and failed jobs
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Queue = require('bull');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10)
};

async function clearCSVJobs() {
  let csvQueue;
  
  try {
    console.log('📡 Connecting to Redis...');
    csvQueue = new Queue('csv-generation', {
      redis: redisConfig
    });

    // Use a timeout for connection
    const connectionPromise = new Promise((resolve, reject) => {
      csvQueue.on('ready', () => {
        console.log('✅ Connected to CSV queue');
        resolve();
      });
      
      csvQueue.on('error', (error) => {
        if (error.code !== 'ECONNREFUSED') {
          reject(error);
        }
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);
    });

    await connectionPromise;

    // Get all job states
    console.log('\n📊 Checking job states...');
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      csvQueue.getWaiting().catch(() => []),
      csvQueue.getActive().catch(() => []),
      csvQueue.getCompleted().catch(() => []),
      csvQueue.getFailed().catch(() => []),
      csvQueue.getDelayed().catch(() => [])
    ]);

    console.log(`   Waiting: ${waiting.length}`);
    console.log(`   Active: ${active.length}`);
    console.log(`   Delayed: ${delayed.length}`);
    console.log(`   Completed: ${completed.length}`);
    console.log(`   Failed: ${failed.length}`);

    let removedCount = 0;

    // Remove waiting jobs
    if (waiting.length > 0) {
      console.log(`\n🗑️  Removing ${waiting.length} waiting jobs...`);
      for (const job of waiting) {
        try {
          await job.remove();
          removedCount++;
          console.log(`   ✅ Removed waiting job: ${job.id}`);
        } catch (error) {
          console.error(`   ❌ Error removing job ${job.id}:`, error.message);
        }
      }
    }

    // Remove active jobs
    if (active.length > 0) {
      console.log(`\n🗑️  Removing ${active.length} active jobs...`);
      for (const job of active) {
        try {
          await job.remove();
          removedCount++;
          console.log(`   ✅ Removed active job: ${job.id}`);
        } catch (error) {
          console.error(`   ❌ Error removing job ${job.id}:`, error.message);
        }
      }
    }

    // Remove delayed jobs
    if (delayed.length > 0) {
      console.log(`\n🗑️  Removing ${delayed.length} delayed jobs...`);
      for (const job of delayed) {
        try {
          await job.remove();
          removedCount++;
          console.log(`   ✅ Removed delayed job: ${job.id}`);
        } catch (error) {
          console.error(`   ❌ Error removing job ${job.id}:`, error.message);
        }
      }
    }

    // Remove failed jobs
    if (failed.length > 0) {
      console.log(`\n🗑️  Removing ${failed.length} failed jobs...`);
      for (const job of failed) {
        try {
          await job.remove();
          removedCount++;
          console.log(`   ✅ Removed failed job: ${job.id}`);
        } catch (error) {
          console.error(`   ❌ Error removing job ${job.id}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Cleanup complete! Removed ${removedCount} jobs total`);
    
    // Verify cleanup
    const [finalWaiting, finalActive, finalDelayed] = await Promise.all([
      csvQueue.getWaiting().catch(() => []),
      csvQueue.getActive().catch(() => []),
      csvQueue.getDelayed().catch(() => [])
    ]);

    console.log('\n📊 Final state:');
    console.log(`   Waiting: ${finalWaiting.length}`);
    console.log(`   Active: ${finalActive.length}`);
    console.log(`   Delayed: ${finalDelayed.length}`);

    if (finalWaiting.length === 0 && finalActive.length === 0 && finalDelayed.length === 0) {
      console.log('\n✅ Queue is now empty - ready for fresh jobs!');
    }

    await csvQueue.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error clearing CSV jobs:', error.message);
    if (csvQueue) {
      try {
        await csvQueue.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    process.exit(1);
  }
}

// Run the script
clearCSVJobs();
