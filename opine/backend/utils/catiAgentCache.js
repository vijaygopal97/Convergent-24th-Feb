/**
 * Redis Cache for CATI Agent Registration Status
 * 
 * Caches agent registration status to avoid database queries on every call.
 * Pattern: cati:agent:registered:{interviewerId}:{phoneNumber}:{provider}
 * 
 * Cache TTL: 24 hours (agents rarely change registration status)
 */

const redisOps = require('./redisClient');

const CACHE_PREFIX = 'cati:agent:registered';
const CACHE_TTL = 86400; // 24 hours in seconds

/**
 * Get cached registration status
 * @param {string} interviewerId - Interviewer user ID
 * @param {string} phoneNumber - Phone number
 * @param {string} providerName - Provider name (e.g., 'cloudtelephony')
 * @returns {Promise<boolean|null>} - true if registered, false if not, null if not cached
 */
async function getCachedRegistrationStatus(interviewerId, phoneNumber, providerName) {
  try {
    const redisClient = redisOps.getClient();
    if (!redisClient) {
      return null; // Redis not available, fallback to database
    }

    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    const cached = await redisClient.get(cacheKey);
    
    if (cached === null) {
      return null; // Not cached
    }
    
    // Parse cached value (stored as 'true' or 'false')
    return cached === 'true';
  } catch (error) {
    console.warn('⚠️ [AgentCache] Error reading from cache:', error.message);
    return null; // On error, fallback to database
  }
}

/**
 * Set cached registration status
 * @param {string} interviewerId - Interviewer user ID
 * @param {string} phoneNumber - Phone number
 * @param {string} providerName - Provider name (e.g., 'cloudtelephony')
 * @param {boolean} isRegistered - Registration status
 * @returns {Promise<void>}
 */
async function setCachedRegistrationStatus(interviewerId, phoneNumber, providerName, isRegistered) {
  try {
    const redisClient = redisOps.getClient();
    if (!redisClient) {
      return; // Redis not available, skip caching
    }

    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    await redisClient.setex(cacheKey, CACHE_TTL, isRegistered ? 'true' : 'false');
    
    console.log(`✅ [AgentCache] Cached registration status: ${cacheKey} = ${isRegistered}`);
  } catch (error) {
    console.warn('⚠️ [AgentCache] Error writing to cache:', error.message);
    // Non-critical - don't throw, just log
  }
}

/**
 * Invalidate cached registration status (when agent is registered/unregistered)
 * @param {string} interviewerId - Interviewer user ID
 * @param {string} phoneNumber - Phone number
 * @param {string} providerName - Provider name (e.g., 'cloudtelephony')
 * @returns {Promise<void>}
 */
async function invalidateCachedRegistrationStatus(interviewerId, phoneNumber, providerName) {
  try {
    const redisClient = redisOps.getClient();
    if (!redisClient) {
      return; // Redis not available, skip
    }

    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    await redisClient.del(cacheKey);
    
    console.log(`🗑️ [AgentCache] Invalidated cache: ${cacheKey}`);
  } catch (error) {
    console.warn('⚠️ [AgentCache] Error invalidating cache:', error.message);
    // Non-critical - don't throw, just log
  }
}

module.exports = {
  getCachedRegistrationStatus,
  setCachedRegistrationStatus,
  invalidateCachedRegistrationStatus
};

