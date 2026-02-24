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
    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    
    // Use redisOps.get() which handles both Redis and in-memory fallback
    // redisOps.get() automatically JSON.parses the value
    const cached = await redisOps.get(cacheKey);
    
    if (cached === null || cached === undefined) {
      return null; // Not cached
    }
    
    // redisOps stores values as JSON, so boolean true/false will be returned as boolean
    // Handle both boolean and string (for backward compatibility with old cache entries)
    if (typeof cached === 'boolean') {
      return cached;
    }
    if (typeof cached === 'string') {
      return cached === 'true' || cached === '"true"';
    }
    
    return null;
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
    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    
    // Use redisOps.set() which handles both Redis and in-memory fallback
    // Store as boolean (redisOps will JSON.stringify it automatically)
    await redisOps.set(cacheKey, isRegistered, CACHE_TTL);
    
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
    const cacheKey = `${CACHE_PREFIX}:${interviewerId}:${phoneNumber}:${providerName}`;
    
    // Use redisOps.del() which handles both Redis and in-memory fallback
    await redisOps.del(cacheKey);
    
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

