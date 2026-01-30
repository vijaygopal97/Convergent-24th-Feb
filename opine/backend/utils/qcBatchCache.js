const redisOps = require('./redisClient');
const QCBatch = require('../models/QCBatch');

// Cache TTL: 5 minutes (stats can be slightly stale, acceptable for performance)
const BATCH_LIST_CACHE_TTL = 300; // 5 minutes
const BATCH_DETAILS_CACHE_TTL = 300; // 5 minutes
const BATCH_STATS_CACHE_TTL = 300; // 5 minutes

// Cache key prefixes
const CACHE_KEY_PREFIX = {
  BATCH_LIST: 'qc-batches:survey:',
  BATCH_DETAILS: 'qc-batch:',
  BATCH_STATS: 'qc-batch-stats:'
};

/**
 * Get cache key for batch list
 */
const getBatchListCacheKey = (surveyId, page, limit, filters = {}) => {
  const filterHash = JSON.stringify(filters);
  return `${CACHE_KEY_PREFIX.BATCH_LIST}${surveyId}:page:${page}:limit:${limit}:filters:${Buffer.from(filterHash).toString('base64').substring(0, 20)}`;
};

/**
 * Get cache key for batch details
 */
const getBatchDetailsCacheKey = (batchId, responsePage = 1, responseLimit = 50) => {
  return `${CACHE_KEY_PREFIX.BATCH_DETAILS}${batchId}:responses:${responsePage}:${responseLimit}`;
};

/**
 * Get cache key for batch stats
 */
const getBatchStatsCacheKey = (batchId) => {
  return `${CACHE_KEY_PREFIX.BATCH_STATS}${batchId}`;
};

/**
 * Get batch list from cache or database (Cache-Aside pattern)
 */
const getBatchList = async (surveyId, options = {}) => {
  const {
    page = 1,
    limit = 20,
    status,
    interviewerId,
    useCache = true
  } = options;

  const filters = { status, interviewerId };
  const cacheKey = getBatchListCacheKey(surveyId, page, limit, filters);

  // Try cache first
  if (useCache) {
    try {
      const cached = await redisOps.get(cacheKey);
      if (cached) {
        console.log(`✅ QC Batch list cache HIT: survey=${surveyId}, page=${page}`);
        return cached;
      }
      console.log(`❌ QC Batch list cache MISS: survey=${surveyId}, page=${page}`);
    } catch (error) {
      console.warn('⚠️ Cache read error, falling back to DB:', error.message);
    }
  }

  // Cache miss - will be populated after DB query
  return null;
};

/**
 * Set batch list in cache
 */
const setBatchList = async (surveyId, page, limit, filters, data) => {
  const cacheKey = getBatchListCacheKey(surveyId, page, limit, filters);
  try {
    await redisOps.set(cacheKey, data, BATCH_LIST_CACHE_TTL);
    console.log(`✅ QC Batch list cached: survey=${surveyId}, page=${page}`);
  } catch (error) {
    console.warn('⚠️ Cache write error (non-blocking):', error.message);
  }
};

/**
 * Get batch details from cache
 */
const getBatchDetails = async (batchId, responsePage = 1, responseLimit = 50) => {
  const cacheKey = getBatchDetailsCacheKey(batchId, responsePage, responseLimit);
  try {
    const cached = await redisOps.get(cacheKey);
    if (cached) {
      console.log(`✅ QC Batch details cache HIT: batch=${batchId}`);
      return cached;
    }
    console.log(`❌ QC Batch details cache MISS: batch=${batchId}`);
  } catch (error) {
    console.warn('⚠️ Cache read error:', error.message);
  }
  return null;
};

/**
 * Set batch details in cache
 */
const setBatchDetails = async (batchId, responsePage, responseLimit, data) => {
  const cacheKey = getBatchDetailsCacheKey(batchId, responsePage, responseLimit);
  try {
    await redisOps.set(cacheKey, data, BATCH_DETAILS_CACHE_TTL);
    console.log(`✅ QC Batch details cached: batch=${batchId}`);
  } catch (error) {
    console.warn('⚠️ Cache write error (non-blocking):', error.message);
  }
};

/**
 * Invalidate batch list cache for a survey
 */
const invalidateBatchListCache = async (surveyId) => {
  // Invalidate all pages for this survey by pattern matching
  // Note: Redis doesn't support pattern deletion in our wrapper, so we'll invalidate on batch updates
  console.log(`🗑️ Batch list cache should be invalidated for survey: ${surveyId}`);
  // In production, you'd use Redis SCAN + DEL for pattern matching
  // For now, we'll rely on TTL expiration
};

/**
 * Invalidate batch details cache
 */
const invalidateBatchDetailsCache = async (batchId) => {
  const cacheKey = getBatchDetailsCacheKey(batchId);
  try {
    // Delete all response page variations (approximate - would need pattern matching in production)
    await redisOps.del(cacheKey);
    console.log(`🗑️ Batch details cache invalidated: batch=${batchId}`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

/**
 * Invalidate batch stats cache
 */
const invalidateBatchStatsCache = async (batchId) => {
  const cacheKey = getBatchStatsCacheKey(batchId);
  try {
    await redisOps.del(cacheKey);
    console.log(`🗑️ Batch stats cache invalidated: batch=${batchId}`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

module.exports = {
  getBatchList,
  setBatchList,
  getBatchDetails,
  setBatchDetails,
  invalidateBatchListCache,
  invalidateBatchDetailsCache,
  invalidateBatchStatsCache,
  getBatchStatsCacheKey,
  BATCH_LIST_CACHE_TTL,
  BATCH_DETAILS_CACHE_TTL,
  BATCH_STATS_CACHE_TTL
};










