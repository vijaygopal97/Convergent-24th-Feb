require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const redisOps = require('./redisClient');
const mongoose = require('mongoose');

// Redis cache key prefix for CATI queue (legacy - single ID cache)
const CACHE_KEY_PREFIX = 'cati:next:';
const CACHE_TTL = 300; // 5 minutes (same as AC priority cache)

// NEW: Redis LIST key prefix for LPOP-based queue (atomic queue operations)
const QUEUE_KEY_PREFIX = 'cati:queue:';
const QUEUE_BUFFER_SIZE = 500; // Maintain 500 IDs in queue buffer for high traffic (50+ concurrent interviewers)
const QUEUE_REFILL_THRESHOLD = 100; // Refill when queue drops below 100 IDs (ensures buffer never runs out)

/**
 * Get cached next available queue entry for a survey/AC/priority combination
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @returns {Object|null} Cached queue entry ID or null
 */
const getCachedNextEntry = async (surveyId, acName, priority) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    const cached = await redisOps.get(cacheKey);
    return cached;
  } catch (error) {
    console.warn('⚠️ CATI queue cache get error:', error.message);
    return null;
  }
};

/**
 * Set cached next available queue entry
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {String} queueEntryId - Queue entry ID
 */
const setCachedNextEntry = async (surveyId, acName, priority, queueEntryId) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    await redisOps.set(cacheKey, queueEntryId, CACHE_TTL);
  } catch (error) {
    console.warn('⚠️ CATI queue cache set error:', error.message);
    // Non-blocking - continue even if cache fails
  }
};

/**
 * Clear cached next available queue entry (when entry is assigned/completed)
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 */
const clearCachedNextEntry = async (surveyId, acName, priority) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    await redisOps.del(cacheKey);
  } catch (error) {
    console.warn('⚠️ CATI queue cache clear error:', error.message);
    // Non-blocking - continue even if cache fails
  }
};

/**
 * Batch get cached entries (Phase 6: Pipeline optimization)
 * @param {Array} keys - Array of {surveyId, acName, priority} objects
 * @returns {Object} Map of cacheKey -> entryId or null
 */
const batchGetCachedEntries = async (keys) => {
  try {
    const cacheKeys = keys.map(({ surveyId, acName, priority }) => 
      `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`
    );
    
    // Use Redis pipeline for batch operations
    const commands = cacheKeys.map(key => ['get', key]);
    const results = await redisOps.pipeline(commands);
    
    const resultMap = {};
    cacheKeys.forEach((key, index) => {
      const [error, value] = results[index] || [null, null];
      if (!error && value) {
        resultMap[key] = value;
      }
    });
    
    return resultMap;
  } catch (error) {
    console.warn('⚠️ CATI queue cache batch get error:', error.message);
    // Fallback to sequential
    const resultMap = {};
    for (const { surveyId, acName, priority } of keys) {
      const entryId = await getCachedNextEntry(surveyId, acName, priority);
      if (entryId) {
        const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
        resultMap[cacheKey] = entryId;
      }
    }
    return resultMap;
  }
};

/**
 * Clear all cached entries for a survey (when queue is reset)
 * @param {String} surveyId - Survey ID
 */
const clearAllCachedEntriesForSurvey = async (surveyId) => {
  try {
    // Note: This requires Redis KEYS command which can be slow on large datasets
    // For production, consider using Redis SCAN or maintaining a set of cache keys
    // For now, we'll just log - individual entries will expire with TTL
    console.log(`ℹ️  CATI queue cache: Clearing all entries for survey ${surveyId} (entries will expire with TTL)`);
  } catch (error) {
    console.warn('⚠️ CATI queue cache clear all error:', error.message);
  }
};

/**
 * LPOP-BASED QUEUE OPERATIONS (Solution: Atomic Queue Assignment)
 * Top-tier companies (Meta/Facebook) use Redis Lists with LPOP for atomic queue operations
 * This eliminates race conditions completely - only one request can get each ID
 */

/**
 * LPOP: Atomically get and remove next respondent ID from queue
 * This is the core operation that prevents race conditions
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @returns {String|null} Respondent ID or null if queue is empty
 */
const lpopNextRespondent = async (surveyId, acName, priority) => {
  try {
    const queueKey = `${QUEUE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    const respondentId = await redisOps.lpop(queueKey);
    return respondentId; // Returns string ID or null
  } catch (error) {
    console.warn('⚠️ CATI queue LPOP error:', error.message);
    return null;
  }
};

/**
 * RPUSH: Add respondent ID(s) to end of queue (FIFO order)
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {String|Array} respondentIds - Single ID or array of IDs to add
 * @returns {Number} New length of queue
 */
const rpushRespondents = async (surveyId, acName, priority, respondentIds) => {
  try {
    const queueKey = `${QUEUE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    const ids = Array.isArray(respondentIds) ? respondentIds : [respondentIds];
    const length = await redisOps.rpush(queueKey, ...ids);
    return length;
  } catch (error) {
    console.warn('⚠️ CATI queue RPUSH error:', error.message);
    return 0;
  }
};

/**
 * LLEN: Get current queue length
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @returns {Number} Queue length
 */
const getQueueLength = async (surveyId, acName, priority) => {
  try {
    const queueKey = `${QUEUE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    return await redisOps.llen(queueKey);
  } catch (error) {
    console.warn('⚠️ CATI queue LLEN error:', error.message);
    return 0;
  }
};

/**
 * Populate queue from MongoDB when empty or low
 * This maintains buffer for high traffic scenarios
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {Object} mongooseModel - CatiRespondentQueue mongoose model
 * @param {Number} limit - Number of IDs to fetch (default: QUEUE_BUFFER_SIZE)
 * @param {Array} excludeIds - Array of IDs to exclude (already assigned)
 * @returns {Number} Number of IDs added to queue
 */
const populateQueueFromDB = async (surveyId, acName, priority, mongooseModel, limit = QUEUE_BUFFER_SIZE, excludeIds = []) => {
  try {
    const surveyObjectId = new mongoose.Types.ObjectId(surveyId);
    
    // Build query for pending respondents with this AC and priority
    const query = {
      survey: surveyObjectId,
      status: 'pending',
      'respondentContact.ac': acName
    };
    
    // Exclude already assigned IDs
    if (excludeIds.length > 0) {
      const excludeObjectIds = excludeIds
        .filter(id => mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));
      if (excludeObjectIds.length > 0) {
        query._id = { $nin: excludeObjectIds };
      }
    }
    
    // Fetch pending respondents (oldest first - FIFO)
    const respondents = await mongooseModel.find(query)
      .sort({ createdAt: 1 })
      .limit(limit)
      .select('_id')
      .lean();
    
    if (respondents.length === 0) {
      console.log(`ℹ️  No pending respondents found for survey ${surveyId}, AC: ${acName}, priority: ${priority}`);
      return 0;
    }
    
    // Extract IDs and push to Redis queue
    const respondentIds = respondents.map(r => r._id.toString());
    const queueLength = await rpushRespondents(surveyId, acName, priority, respondentIds);
    
    console.log(`✅ Populated queue: ${respondentIds.length} IDs added (survey: ${surveyId}, AC: ${acName}, priority: ${priority}, queue length: ${queueLength})`);
    return respondentIds.length;
  } catch (error) {
    console.error('❌ Error populating queue from DB:', error.message);
    return 0;
  }
};

/**
 * Get next respondent ID with automatic queue refilling
 * This is the main function used by the controller
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {Object} mongooseModel - CatiRespondentQueue mongoose model
 * @param {Array} excludeIds - Array of IDs to exclude
 * @returns {String|null} Respondent ID or null if none available
 */
const getNextRespondentIdWithRefill = async (surveyId, acName, priority, mongooseModel, excludeIds = []) => {
  try {
    // Step 1: Try LPOP (atomic - only one request gets each ID)
    let respondentId = await lpopNextRespondent(surveyId, acName, priority);
    
    // Step 2: Check queue length and refill if needed (background operation)
    const queueLength = await getQueueLength(surveyId, acName, priority);
    
    if (queueLength < QUEUE_REFILL_THRESHOLD) {
      // Refill queue in background (don't wait - return ID immediately if we have one)
      // This ensures we maintain buffer for high traffic
      populateQueueFromDB(surveyId, acName, priority, mongooseModel, QUEUE_BUFFER_SIZE, excludeIds)
        .catch(err => console.warn('⚠️ Background queue refill error:', err.message));
    }
    
    // Step 3: If queue was empty, try to populate and LPOP again
    if (!respondentId && queueLength === 0) {
      const added = await populateQueueFromDB(surveyId, acName, priority, mongooseModel, QUEUE_BUFFER_SIZE, excludeIds);
      if (added > 0) {
        // Try LPOP again after population
        respondentId = await lpopNextRespondent(surveyId, acName, priority);
      }
    }
    
    return respondentId;
  } catch (error) {
    console.error('❌ Error in getNextRespondentIdWithRefill:', error.message);
    return null;
  }
};

/**
 * Initialize queue for a survey/AC/priority combination
 * Call this when respondents are first added to the queue
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {Object} mongooseModel - CatiRespondentQueue mongoose model
 * @returns {Number} Number of IDs added to queue
 */
const initializeQueue = async (surveyId, acName, priority, mongooseModel) => {
  try {
    const currentLength = await getQueueLength(surveyId, acName, priority);
    if (currentLength >= QUEUE_BUFFER_SIZE) {
      console.log(`ℹ️  Queue already initialized (length: ${currentLength}) for survey ${surveyId}, AC: ${acName}, priority: ${priority}`);
      return currentLength;
    }
    
    const added = await populateQueueFromDB(surveyId, acName, priority, mongooseModel, QUEUE_BUFFER_SIZE, []);
    return added;
  } catch (error) {
    console.error('❌ Error initializing queue:', error.message);
    return 0;
  }
};

/**
 * Clear queue for a survey/AC/priority combination
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 */
const clearQueue = async (surveyId, acName, priority) => {
  try {
    const queueKey = `${QUEUE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    await redisOps.del(queueKey);
    console.log(`🗑️  Cleared queue for survey ${surveyId}, AC: ${acName}, priority: ${priority}`);
  } catch (error) {
    console.warn('⚠️ CATI queue clear error:', error.message);
  }
};

/**
 * Get all IDs currently in Redis queues for a survey/AC/priority combination
 * Used to exclude queue IDs from fallback DB queries to prevent conflicts
 * @param {String} surveyId - Survey ID
 * @param {Array} sortedPriorities - Array of sorted priority numbers
 * @param {Object} priorityACs - Map of priority -> array of AC names
 * @returns {Array} Array of respondent IDs currently in queues
 */
const getAllQueueIdsForSurvey = async (surveyId, sortedPriorities, priorityACs) => {
  try {
    const queueIds = [];
    
    // Get IDs from all queues for this survey
    for (const priority of sortedPriorities) {
      const acNames = priorityACs[priority] || [];
      for (const acName of acNames) {
        const queueKey = `${QUEUE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
        const queueLength = await redisOps.llen(queueKey);
        
        if (queueLength > 0) {
          // Get all IDs in this queue (without removing them)
          const ids = await redisOps.lrange(queueKey, 0, queueLength - 1);
          if (ids && Array.isArray(ids)) {
            queueIds.push(...ids.filter(id => id && typeof id === 'string'));
          }
        }
      }
    }
    
    return queueIds;
  } catch (error) {
    console.warn('⚠️ Error getting queue IDs for survey:', error.message);
    return [];
  }
};

/**
 * Clear all queues for a survey (when queue is reset)
 * @param {String} surveyId - Survey ID
 */
const clearAllQueuesForSurvey = async (surveyId) => {
  try {
    const rawClient = redisOps.getClient();
    if (!rawClient || redisOps.isUsingInMemory()) {
      console.log(`ℹ️  CATI queue: Redis not available, queues will be repopulated on next request for survey ${surveyId}`);
      return;
    }
    
    // Use Redis SCAN to find all queue keys for this survey (safer than KEYS on large datasets)
    const queueKeyPattern = `${QUEUE_KEY_PREFIX}${surveyId}:*`;
    let cursor = '0';
    let clearedCount = 0;
    
    do {
      const [nextCursor, keys] = await rawClient.scan(cursor, 'MATCH', queueKeyPattern, 'COUNT', 100);
      cursor = nextCursor;
      
      if (keys && keys.length > 0) {
        // Delete all matching keys
        await Promise.all(keys.map(key => rawClient.del(key)));
        clearedCount += keys.length;
        console.log(`🗑️  Cleared ${keys.length} queue keys (survey: ${surveyId})`);
      }
    } while (cursor !== '0');
    
    // Also clear legacy cache keys
    const cacheKeyPattern = `${CACHE_KEY_PREFIX}${surveyId}:*`;
    cursor = '0';
    let cacheClearedCount = 0;
    
    do {
      const [nextCursor, keys] = await rawClient.scan(cursor, 'MATCH', cacheKeyPattern, 'COUNT', 100);
      cursor = nextCursor;
      
      if (keys && keys.length > 0) {
        await Promise.all(keys.map(key => rawClient.del(key)));
        cacheClearedCount += keys.length;
      }
    } while (cursor !== '0');
    
    console.log(`✅ Cleared ${clearedCount} queue keys and ${cacheClearedCount} cache keys for survey ${surveyId}`);
  } catch (error) {
    console.warn('⚠️ CATI queue clear all error:', error.message);
    // Fallback: try using KEYS if SCAN fails (less efficient but works)
    try {
      const rawClient = redisOps.getClient();
      if (rawClient) {
        const queueKeyPattern = `${QUEUE_KEY_PREFIX}${surveyId}:*`;
        const keys = await rawClient.keys(queueKeyPattern);
        if (keys && keys.length > 0) {
          await Promise.all(keys.map(key => rawClient.del(key)));
          console.log(`✅ Cleared ${keys.length} queue keys using KEYS fallback for survey ${surveyId}`);
        }
      }
    } catch (fallbackError) {
      console.warn('⚠️ Fallback clear also failed:', fallbackError.message);
    }
  }
};

module.exports = {
  // Legacy functions (kept for backward compatibility)
  getCachedNextEntry,
  setCachedNextEntry,
  clearCachedNextEntry,
  batchGetCachedEntries,
  clearAllCachedEntriesForSurvey,
  
  // NEW: LPOP-based queue functions (primary solution)
  lpopNextRespondent,
  rpushRespondents,
  getQueueLength,
  populateQueueFromDB,
  getNextRespondentIdWithRefill,
  initializeQueue,
  clearQueue,
  getAllQueueIdsForSurvey,
  clearAllQueuesForSurvey
};
