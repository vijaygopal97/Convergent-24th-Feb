#!/usr/bin/env node

/**
 * Check status of a specific CSV job
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Queue = require('bull');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0', 10)
};

const jobId = process.argv[2];

if (!jobId) {
  console.error('Usage: node checkJobStatus.js <jobId>');
  process.exit(1);
}

async function checkJobStatus() {
  let csvQueue;
  
  try {
    console.log(`📡 Checking job: ${jobId}`);
    csvQueue = new Queue('csv-generation', {
      redis: redisConfig
    });

    // Wait for connection
    await new Promise((resolve, reject) => {
      csvQueue.on('ready', resolve);
      csvQueue.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    const job = await csvQueue.getJob(jobId);
    
    if (!job) {
      console.log('❌ Job not found in queue');
      
      // Check all states
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        csvQueue.getWaiting(),
        csvQueue.getActive(),
        csvQueue.getCompleted(),
        csvQueue.getFailed(),
        csvQueue.getDelayed()
      ]);
      
      console.log(`\n📊 Queue states:`);
      console.log(`   Waiting: ${waiting.length}`);
      console.log(`   Active: ${active.length}`);
      console.log(`   Delayed: ${delayed.length}`);
      console.log(`   Completed: ${completed.length}`);
      console.log(`   Failed: ${failed.length}`);
      
      // Check if job ID matches any job
      const allJobs = [...waiting, ...active, ...completed, ...failed, ...delayed];
      const matching = allJobs.find(j => j.id === jobId || j.id.toString().includes(jobId));
      if (matching) {
        console.log(`\n✅ Found job with similar ID: ${matching.id}`);
        const state = await matching.getState();
        console.log(`   State: ${state}`);
      }
      
      await csvQueue.close();
      process.exit(1);
    }

    const state = await job.getState();
    const progress = job.progress();
    const data = job.data;
    
    console.log(`\n📊 Job Status:`);
    console.log(`   Job ID: ${job.id}`);
    console.log(`   State: ${state}`);
    console.log(`   Progress: ${JSON.stringify(progress)}`);
    console.log(`   Created: ${new Date(job.timestamp)}`);
    console.log(`   Processed: ${job.processedOn ? new Date(job.processedOn) : 'Not yet'}`);
    console.log(`   Finished: ${job.finishedOn ? new Date(job.finishedOn) : 'Not yet'}`);
    console.log(`   Failed Reason: ${job.failedReason || 'None'}`);
    console.log(`\n📋 Job Data:`);
    console.log(JSON.stringify(data, null, 2));
    
    if (state === 'active') {
      console.log(`\n⚠️  Job is currently active - check worker logs for progress`);
    } else if (state === 'failed') {
      console.log(`\n❌ Job failed: ${job.failedReason}`);
    } else if (state === 'completed') {
      console.log(`\n✅ Job completed successfully`);
      console.log(`   Result: ${JSON.stringify(job.returnvalue)}`);
    }

    await csvQueue.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error checking job:', error.message);
    if (csvQueue) {
      await csvQueue.close().catch(() => {});
    }
    process.exit(1);
  }
}

checkJobStatus();





























