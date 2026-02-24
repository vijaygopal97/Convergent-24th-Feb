/**
 * Script to clear and reinitialize CATI Redis queues
 * Fixes "No Pending Respondents" errors caused by stale/empty Redis queues
 * 
 * Usage:
 *   node backend/scripts/clearAndReinitCatiQueues.js [surveyId]
 *   If surveyId is not provided, clears and reinitializes queues for all active surveys
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const catiQueueCache = require('../utils/catiQueueCache');
const redisOps = require('../utils/redisClient');
const fs = require('fs').promises;
const path = require('path');

// Models
const Survey = require('../models/Survey');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

// AC Priority Map Redis cache key
const AC_PRIORITY_REDIS_KEY = 'cati:ac_priority_map';
const AC_PRIORITY_CACHE_TTL = 300; // 5 minutes

/**
 * Load AC priority mapping from JSON file (with Redis caching)
 */
const loadACPriorityMap = async () => {
  try {
    // STEP 1: Check Redis cache first (fastest - shared across servers)
    try {
      const cachedMap = await redisOps.get(AC_PRIORITY_REDIS_KEY);
      if (cachedMap && typeof cachedMap === 'object') {
        console.log('⚡ Using Redis cached AC priority map:', Object.keys(cachedMap).length, 'ACs');
        return cachedMap;
      }
    } catch (redisError) {
      console.warn('⚠️ Redis cache check failed, falling back to file:', redisError.message);
    }

    // STEP 2: Load from file (if not in Redis cache)
    const priorityFilePath = path.join(__dirname, '..', 'data', 'CATI_AC_Priority.json');
    
    let map = {};
    try {
      await fs.access(priorityFilePath);
      const fileContent = await fs.readFile(priorityFilePath, 'utf8');
      const priorityData = JSON.parse(fileContent);
      
      // Build map: AC_Name -> Priority (as number)
      if (Array.isArray(priorityData)) {
        priorityData.forEach(item => {
          if (item.AC_Name && item.Priority !== undefined) {
            // Convert Priority to number (handle string "0", "1", etc.)
            const priority = typeof item.Priority === 'string' ? parseInt(item.Priority, 10) : item.Priority;
            if (!isNaN(priority)) {
              map[item.AC_Name] = priority;
            }
          }
        });
      }
      
      console.log('✅ Loaded AC priority map from file:', Object.keys(map).length, 'ACs');
    } catch (fileError) {
      console.log('⚠️  AC Priority file not found or error reading:', fileError.message);
      map = {}; // Return empty map (no priorities)
    }

    // STEP 3: Cache in Redis for future requests (shared across all servers)
    try {
      await redisOps.set(AC_PRIORITY_REDIS_KEY, map, AC_PRIORITY_CACHE_TTL);
      console.log('✅ Cached AC priority map in Redis for', AC_PRIORITY_CACHE_TTL, 'seconds');
    } catch (redisError) {
      console.warn('⚠️ Redis cache set failed (will use file on next request):', redisError.message);
    }

    return map;
  } catch (error) {
    console.error('❌ Error loading AC priority map:', error);
    return {};
  }
};

async function clearAndReinitQueues(surveyId = null) {
  try {
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get surveys to process
    let surveys;
    if (surveyId) {
      const survey = await Survey.findById(surveyId).select('_id surveyName status').lean();
      if (!survey) {
        console.error(`❌ Survey ${surveyId} not found`);
        process.exit(1);
      }
      surveys = [survey];
      console.log(`\n🎯 Processing survey: ${survey.surveyName} (${surveyId})`);
    } else {
      surveys = await Survey.find({ status: 'active' })
        .select('_id surveyName status')
        .lean();
      console.log(`\n📊 Found ${surveys.length} active surveys to process`);
    }

    // Load AC priority map
    console.log('\n📋 Loading AC priority map...');
    const acPriorityMap = await loadACPriorityMap();
    console.log(`✅ Loaded priority map for ${Object.keys(acPriorityMap).length} ACs`);

    let totalCleared = 0;
    let totalReinitialized = 0;

    for (const survey of surveys) {
      const sid = survey._id.toString();
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔍 Processing survey: ${survey.surveyName} (${sid})`);
      console.log(`${'='.repeat(60)}`);

      // Step 1: Check for stuck "assigned" respondents (older than 30 minutes)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const stuckAssigned = await CatiRespondentQueue.countDocuments({
        survey: sid,
        status: 'assigned',
        assignedAt: { $lt: thirtyMinutesAgo }
      });

      if (stuckAssigned > 0) {
        console.log(`⚠️  Found ${stuckAssigned} stuck "assigned" respondents (older than 30 min)`);
        const resetResult = await CatiRespondentQueue.updateMany(
          {
            survey: sid,
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
      }

      // Step 2: Clear all Redis queues for this survey
      console.log('\n🗑️  Clearing Redis queues...');
      await catiQueueCache.clearAllQueuesForSurvey(sid);
      totalCleared++;

      // Step 3: Get all pending respondents and their ACs
      console.log('\n📊 Analyzing pending respondents...');
      const pendingRespondents = await CatiRespondentQueue.find({
        survey: sid,
        status: 'pending'
      })
        .select('respondentContact.ac')
        .limit(5000) // Sample to get AC distribution
        .lean();

      if (pendingRespondents.length === 0) {
        console.log('⚠️  No pending respondents found for this survey');
        continue;
      }

      console.log(`✅ Found ${pendingRespondents.length} pending respondents`);

      // Step 4: Group by AC and initialize queues
      const acNamesSet = new Set();
      pendingRespondents.forEach(r => {
        if (r.respondentContact?.ac) {
          acNamesSet.add(r.respondentContact.ac);
        }
      });

      console.log(`\n🔄 Initializing queues for ${acNamesSet.size} ACs...`);
      let queuesInitialized = 0;

      for (const acName of acNamesSet) {
        const priority = acPriorityMap[acName] || 0;
        if (priority > 0) {
          const initialized = await catiQueueCache.initializeQueue(sid, acName, priority, CatiRespondentQueue);
          if (initialized > 0) {
            queuesInitialized++;
            console.log(`   ✅ Initialized queue for AC: ${acName} (priority: ${priority}, ${initialized} IDs)`);
          }
        } else {
          console.log(`   ⏭️  Skipped AC: ${acName} (priority: ${priority} - not prioritized)`);
        }
      }

      totalReinitialized += queuesInitialized;
      console.log(`\n✅ Survey ${survey.surveyName}: Initialized ${queuesInitialized} queues`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Cleared queues for ${totalCleared} survey(s)`);
    console.log(`✅ Reinitialized ${totalReinitialized} queue(s) total`);
    console.log(`\n✅ Done! CATI queues have been cleared and reinitialized.`);
    console.log(`   Interviewers should now be able to start interviews successfully.`);

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

// Get surveyId from command line args
const surveyId = process.argv[2] || null;

if (surveyId && !mongoose.Types.ObjectId.isValid(surveyId)) {
  console.error(`❌ Invalid survey ID: ${surveyId}`);
  process.exit(1);
}

clearAndReinitQueues(surveyId);

