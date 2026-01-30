/**
 * Background Job: Update QC Batch Stats
 * 
 * This job updates QC batch statistics in the background to avoid
 * calculating stats on every request (which causes memory leaks).
 * 
 * Runs every 5 minutes to keep stats fresh.
 */

const QCBatch = require('../models/QCBatch');
const qcBatchCache = require('../utils/qcBatchCache');

/**
 * Update stats for a single batch
 */
const updateBatchStats = async (batch) => {
  try {
    // Update stats using the model method
    await batch.updateQCStats();
    
    // Invalidate cache after stats update
    await qcBatchCache.invalidateBatchDetailsCache(batch._id.toString());
    await qcBatchCache.invalidateBatchStatsCache(batch._id.toString());
    
    return true;
  } catch (error) {
    console.error(`❌ Error updating stats for batch ${batch._id}:`, error.message);
    return false;
  }
};

/**
 * Update stats for all batches that need updating
 * Only updates batches that are not in 'collecting' status
 */
const updateAllQCBatchStats = async () => {
  try {
    console.log('🔄 Starting QC batch stats update job...');
    
    // Find all batches that need stats updates (not in collecting status)
    const batches = await QCBatch.find({
      status: { $ne: 'collecting' }
    })
      .select('_id survey status qcStats')
      .lean();
    
    console.log(`📊 Found ${batches.length} batches to update`);
    
    let updated = 0;
    let failed = 0;
    
    // Update stats in batches of 10 to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < batches.length; i += batchSize) {
      const batch = batches.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (batchData) => {
          try {
            // Load full batch document to use updateQCStats method
            const batch = await QCBatch.findById(batchData._id);
            if (batch) {
              await updateBatchStats(batch);
              updated++;
            }
          } catch (error) {
            console.error(`❌ Error processing batch ${batchData._id}:`, error.message);
            failed++;
          }
        })
      );
      
      // Small delay between batches to avoid overwhelming the database
      if (i + batchSize < batches.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`✅ QC batch stats update completed: ${updated} updated, ${failed} failed`);
    
    return { updated, failed, total: batches.length };
  } catch (error) {
    console.error('❌ Error in updateAllQCBatchStats:', error);
    throw error;
  }
};

module.exports = {
  updateBatchStats,
  updateAllQCBatchStats
};









