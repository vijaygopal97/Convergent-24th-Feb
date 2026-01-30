/**
 * Start Background Jobs for Materialized Views
 * 
 * Phase 2: Materialized Views Pattern
 * 
 * This module starts the background jobs that update materialized views.
 * Jobs run at regular intervals to keep the views fresh.
 */

const updateAvailableAssignments = require('./updateAvailableAssignments');
const updateCatiPriorityQueue = require('./updateCatiPriorityQueue');
const redisOps = require('../utils/redisClient');
const autoRejectDuplicatePhones = require('./autoRejectDuplicatePhones');
const { updateAllQCBatchStats } = require('./updateQCBatchStats');

let availableAssignmentsInterval = null;
let catiPriorityQueueInterval = null;
let autoRejectDuplicatePhonesInterval = null;
let updateQCBatchStatsInterval = null;
let isJobRunner = false;

async function acquireJobLock() {
  try {
    // Try to acquire lock with 60 second TTL
    const lockKey = 'background_jobs_lock';
    const lockValue = `${process.pid}-${Date.now()}`;
    const acquired = await redisOps.set(lockKey, lockValue, 60, 'NX'); // NX = only set if not exists
    
    if (acquired) {
      // Refresh lock every 30 seconds
      const refreshInterval = setInterval(async () => {
        try {
          await redisOps.set(lockKey, lockValue, 60);
        } catch (err) {
          clearInterval(refreshInterval);
          isJobRunner = false;
        }
      }, 30000);
      
      return true;
    }
    return false;
  } catch (error) {
    // If Redis fails, don't run jobs (fail safe)
    console.warn('⚠️  Could not acquire job lock (Redis unavailable), skipping background jobs');
    return false;
  }
}

async function startBackgroundJobs() {
  console.log('🚀 Attempting to start background jobs for materialized views...');
  
  // CRITICAL: Only one instance should run jobs (use Redis lock)
  isJobRunner = await acquireJobLock();
  
  if (!isJobRunner) {
    console.log('⏭️  Another instance is running background jobs, skipping...');
    return;
  }
  
  console.log('✅ This instance will run background jobs');
  
  // CRITICAL OPTIMIZATION: Increase intervals significantly to reduce load
  // Update available assignments every 60 seconds (much reduced frequency)
  availableAssignmentsInterval = setInterval(async () => {
    try {
      await updateAvailableAssignments();
    } catch (error) {
      console.error('❌ Error in availableAssignments job:', error.message);
    }
  }, 60 * 1000); // 60 seconds (increased from 30)
  
  // Update CATI priority queue every 45 seconds (much reduced frequency)
  catiPriorityQueueInterval = setInterval(async () => {
    try {
      await updateCatiPriorityQueue();
    } catch (error) {
      console.error('❌ Error in catiPriorityQueue job:', error.message);
    }
  }, 45 * 1000); // 45 seconds (increased from 20)

  // Auto-reject duplicate phone numbers in Pending_Approval (lightweight windowed scan)
  autoRejectDuplicatePhonesInterval = setInterval(async () => {
    try {
      await autoRejectDuplicatePhones();
    } catch (error) {
      console.error('❌ Error in autoRejectDuplicatePhones job:', error.message);
    }
  }, 15 * 60 * 1000); // every 15 minutes
  
  // Update QC batch stats every 5 minutes (keeps stats fresh without blocking requests)
  updateQCBatchStatsInterval = setInterval(async () => {
    try {
      await updateAllQCBatchStats();
    } catch (error) {
      console.error('❌ Error in updateQCBatchStats job:', error.message);
    }
  }, 5 * 60 * 1000); // every 5 minutes
  
  // Run immediately on startup (with delay to avoid startup load)
  setTimeout(() => {
    updateAvailableAssignments().catch(err => console.error('Startup error:', err.message));
  }, 10000); // 10 second delay
  
  setTimeout(() => {
    updateCatiPriorityQueue().catch(err => console.error('Startup error:', err.message));
  }, 15000); // 15 second delay
  
  setTimeout(() => {
    updateAllQCBatchStats().catch(err => console.error('Startup error:', err.message));
  }, 20000); // 20 second delay
  
  console.log('✅ Background jobs started (60s, 45s, 5min intervals, single instance)');
}

async function stopBackgroundJobs() {
  console.log('🛑 Stopping background jobs...');
  
  if (availableAssignmentsInterval) {
    clearInterval(availableAssignmentsInterval);
    availableAssignmentsInterval = null;
  }
  
  if (catiPriorityQueueInterval) {
    clearInterval(catiPriorityQueueInterval);
    catiPriorityQueueInterval = null;
  }

  if (autoRejectDuplicatePhonesInterval) {
    clearInterval(autoRejectDuplicatePhonesInterval);
    autoRejectDuplicatePhonesInterval = null;
  }

  if (updateQCBatchStatsInterval) {
    clearInterval(updateQCBatchStatsInterval);
    updateQCBatchStatsInterval = null;
  }
  
  // Release lock
  if (isJobRunner) {
    try {
      await redisOps.del('background_jobs_lock');
    } catch (error) {
      // Ignore errors on shutdown
    }
    isJobRunner = false;
  }
  
  console.log('✅ Background jobs stopped');
}

// Handle graceful shutdown
process.on('SIGTERM', stopBackgroundJobs);
process.on('SIGINT', stopBackgroundJobs);

module.exports = {
  startBackgroundJobs,
  stopBackgroundJobs
};

