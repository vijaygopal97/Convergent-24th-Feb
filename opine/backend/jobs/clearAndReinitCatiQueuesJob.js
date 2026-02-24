/**
 * Scheduled Job: Clear and Reinitialize CATI Queues
 * 
 * Purpose: Periodically clear and reinitialize Redis queues for CATI surveys
 * This prevents "No Pending Respondents" errors caused by stale/empty Redis queues
 * 
 * Runs: Every 15 minutes (via node-cron in server.js)
 * 
 * What it does:
 * 1. Checks for stuck "assigned" respondents (older than 30 minutes) and resets them
 * 2. Clears all Redis queues for active surveys
 * 3. Reinitializes queues with pending respondents grouped by AC
 * 
 * Safety Features:
 * - Redis lock prevents concurrent runs
 * - Runs as isolated child process (won't crash main server)
 * - Non-blocking execution
 * - Proper error handling
 */

const { spawn } = require('child_process');
const path = require('path');
const redisOps = require('../utils/redisClient');

const LOCK_KEY = 'job:clearAndReinitCatiQueues:lock';
const LOCK_TTL = 1200; // 20 minutes (longer than max execution time)
const SCRIPT_PATH = path.join(__dirname, '../scripts/clearAndReinitCatiQueues.js');

async function runClearAndReinitCatiQueues() {
  const startTime = Date.now();
  const lockValue = `${process.pid}-${Date.now()}`;
  
  try {
    // Check if lock exists (prevent concurrent runs)
    const existingLock = await redisOps.get(LOCK_KEY);
    if (existingLock) {
      console.log('⏭️  clearAndReinitCatiQueues: Lock exists, skipping (another instance is running)');
      return;
    }

    // Acquire lock
    await redisOps.set(LOCK_KEY, lockValue, LOCK_TTL);
    console.log('🔒 Acquired lock for clearAndReinitCatiQueues job');

    // Spawn child process to run the script (isolated, won't crash main server)
    return new Promise((resolve, reject) => {
      const child = spawn('node', [SCRIPT_PATH], {
        cwd: path.join(__dirname, '../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', async (code) => {
        const duration = Date.now() - startTime;
        
        // Release lock
        try {
          const currentLock = await redisOps.get(LOCK_KEY);
          if (currentLock === lockValue) {
            await redisOps.del(LOCK_KEY);
            console.log('🔓 Released lock for clearAndReinitCatiQueues job');
          }
        } catch (lockError) {
          console.warn('⚠️  Error releasing lock:', lockError.message);
        }

        if (code === 0) {
          console.log(`✅ clearAndReinitCatiQueues job completed successfully in ${duration}ms`);
          // Log summary if available
          const summaryMatch = stdout.match(/SUMMARY[\s\S]*?Done!/);
          if (summaryMatch) {
            console.log('📊 Job Summary:', summaryMatch[0].replace(/\n/g, ' | '));
          }
          resolve({ success: true, duration });
        } else {
          console.error(`❌ clearAndReinitCatiQueues job failed with exit code ${code}`);
          if (stderr) {
            console.error('Error output:', stderr.substring(0, 500)); // Limit error output
          }
          reject(new Error(`Script exited with code ${code}`));
        }
      });

      child.on('error', async (error) => {
        // Release lock on error
        try {
          const currentLock = await redisOps.get(LOCK_KEY);
          if (currentLock === lockValue) {
            await redisOps.del(LOCK_KEY);
          }
        } catch (lockError) {
          // Ignore lock errors
        }
        
        console.error('❌ Error spawning clearAndReinitCatiQueues process:', error.message);
        reject(error);
      });

      // Set timeout to prevent hanging (30 minutes max)
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        console.error('⏱️  clearAndReinitCatiQueues job timed out after 30 minutes');
        reject(new Error('Job timeout'));
      }, 30 * 60 * 1000);

      child.on('close', () => {
        clearTimeout(timeout);
      });
    });

  } catch (error) {
    // Release lock on error
    try {
      const currentLock = await redisOps.get(LOCK_KEY);
      if (currentLock === lockValue) {
        await redisOps.del(LOCK_KEY);
      }
    } catch (lockError) {
      // Ignore lock errors
    }

    console.error('❌ Error in clearAndReinitCatiQueues job:', error.message);
    throw error;
  }
}

module.exports = runClearAndReinitCatiQueues;
