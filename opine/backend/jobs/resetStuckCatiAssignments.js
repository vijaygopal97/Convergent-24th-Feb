/**
 * Scheduled Job: Reset Stuck CATI Assignments
 * 
 * Purpose: Automatically reset respondents stuck in "assigned" status back to "pending"
 * This prevents "No Pending Respondents" errors caused by abandoned interviews
 * 
 * Runs: Every 15 minutes (via cron or PM2 cron)
 * 
 * What it does:
 * 1. Finds respondents stuck in "assigned" status for > 30 minutes
 * 2. Resets them back to "pending" status
 * 3. Clears their assignment metadata
 * 4. Optionally reinitializes Redis queues for affected surveys
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const catiQueueCache = require('../utils/catiQueueCache');
const redisOps = require('../utils/redisClient');
const fs = require('fs').promises;
const path = require('path');

const AC_PRIORITY_REDIS_KEY = 'cati:ac_priority_map';
const AC_PRIORITY_CACHE_TTL = 300;

// Load AC priority map (same logic as controller)
const loadACPriorityMap = async () => {
  try {
    const cachedMap = await redisOps.get(AC_PRIORITY_REDIS_KEY);
    if (cachedMap && typeof cachedMap === 'object') {
      return cachedMap;
    }

    const priorityFilePath = path.join(__dirname, '..', 'data', 'CATI_AC_Priority.json');
    let map = {};
    
    try {
      await fs.access(priorityFilePath);
      const fileContent = await fs.readFile(priorityFilePath, 'utf8');
      const priorityData = JSON.parse(fileContent);
      
      if (Array.isArray(priorityData)) {
        priorityData.forEach(item => {
          if (item.AC_Name && item.Priority !== undefined) {
            const priority = typeof item.Priority === 'string' ? parseInt(item.Priority, 10) : item.Priority;
            if (!isNaN(priority)) {
              map[item.AC_Name] = priority;
            }
          }
        });
      }
    } catch (fileError) {
      console.log('⚠️  AC Priority file not found:', fileError.message);
    }

    try {
      await redisOps.set(AC_PRIORITY_REDIS_KEY, map, AC_PRIORITY_CACHE_TTL);
    } catch (redisError) {
      // Ignore Redis errors
    }

    return map;
  } catch (error) {
    console.error('❌ Error loading AC priority map:', error);
    return {};
  }
};

async function resetStuckAssignments() {
  const startTime = Date.now();
  console.log('\n🔄 Starting resetStuckCatiAssignments job...');
  
  try {
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
      console.log('✅ Connected to MongoDB');
    }

    // Find respondents stuck in "assigned" status for > 30 minutes
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    const stuckRespondents = await CatiRespondentQueue.find({
      status: 'assigned',
      assignedAt: { $lt: thirtyMinutesAgo }
    })
      .select('_id survey respondentContact.ac assignedTo assignedAt')
      .lean();

    if (stuckRespondents.length === 0) {
      console.log('✅ No stuck assignments found');
      return { reset: 0, surveys: [] };
    }

    console.log(`⚠️  Found ${stuckRespondents.length} stuck assignments (older than 30 minutes)`);

    // Group by survey for queue reinitialization
    const surveysAffected = new Set();
    stuckRespondents.forEach(r => {
      if (r.survey) {
        surveysAffected.add(r.survey.toString());
      }
    });

    // Reset stuck respondents back to pending
    const resetResult = await CatiRespondentQueue.updateMany(
      {
        status: 'assigned',
        assignedAt: { $lt: thirtyMinutesAgo }
      },
      {
        $set: {
          status: 'pending',
          assignedTo: null,
          assignedAt: null
        }
      }
    );

    console.log(`✅ Reset ${resetResult.modifiedCount} stuck respondents back to pending`);

    // Reinitialize Redis queues for affected surveys (optional but recommended)
    if (surveysAffected.size > 0 && resetResult.modifiedCount > 0) {
      console.log(`🔄 Reinitializing Redis queues for ${surveysAffected.size} affected survey(s)...`);
      
      const acPriorityMap = await loadACPriorityMap();
      let queuesReinitialized = 0;

      for (const surveyId of surveysAffected) {
        try {
          // Get AC distribution from reset respondents
          const surveyStuckRespondents = stuckRespondents.filter(
            r => r.survey && r.survey.toString() === surveyId
          );

          const acNamesSet = new Set();
          surveyStuckRespondents.forEach(r => {
            if (r.respondentContact?.ac) {
              acNamesSet.add(r.respondentContact.ac);
            }
          });

          // Initialize queues for each AC
          for (const acName of acNamesSet) {
            const priority = acPriorityMap[acName] || 0;
            if (priority > 0) {
              const initialized = await catiQueueCache.initializeQueue(
                surveyId,
                acName,
                priority,
                CatiRespondentQueue
              );
              if (initialized > 0) {
                queuesReinitialized++;
              }
            }
          }
        } catch (surveyError) {
          console.warn(`⚠️ Error reinitializing queues for survey ${surveyId}:`, surveyError.message);
        }
      }

      console.log(`✅ Reinitialized ${queuesReinitialized} Redis queues`);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Job completed in ${duration}ms`);
    console.log(`   - Reset: ${resetResult.modifiedCount} respondents`);
    console.log(`   - Surveys affected: ${surveysAffected.size}`);

    return {
      reset: resetResult.modifiedCount,
      surveys: Array.from(surveysAffected)
    };

  } catch (error) {
    console.error('❌ Error in resetStuckCatiAssignments:', error.message);
    console.error(error.stack);
    throw error;
  }
}

// Export for use in cron jobs or PM2 cron
module.exports = resetStuckAssignments;

// If run directly (for testing)
if (require.main === module) {
  resetStuckAssignments()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Job failed:', error);
      process.exit(1);
    });
}

