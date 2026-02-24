/**
 * Make CATI responses in QC Batch eligible by setting isSampleResponse = true
 * This will allow them to appear in the AvailableAssignment queue
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

async function makeCatiQcBatchEligible() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔄 Making CATI QC Batch Responses Eligible');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Find all CATI responses in QC Batch that are not sample responses
    const catiInQcBatch = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'cati',
      qcBatch: { $exists: true, $ne: null },
      $or: [
        { isSampleResponse: { $exists: false } },
        { isSampleResponse: false },
        { isSampleResponse: null }
      ]
    })
      .select('_id qcBatch isSampleResponse')
      .read('secondaryPreferred')
      .maxTimeMS(60000)
      .lean();

    console.log(`📊 Found ${catiInQcBatch.length} CATI responses in QC Batch (not sample)\n`);

    if (catiInQcBatch.length === 0) {
      console.log('✅ No responses to update\n');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Update all of them to set isSampleResponse = true
    const responseIds = catiInQcBatch.map(r => r._id);
    
    console.log('🔄 Updating responses...');
    const updateResult = await SurveyResponse.updateMany(
      { _id: { $in: responseIds } },
      { $set: { isSampleResponse: true } }
    );

    console.log(`✅ Updated ${updateResult.modifiedCount} responses\n`);

    // Verify the update
    const verifyCount = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'cati',
      qcBatch: { $exists: true, $ne: null },
      isSampleResponse: true
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Update Complete');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Updated: ${updateResult.modifiedCount} responses`);
    console.log(`   Verified (CATI in QC Batch with isSampleResponse=true): ${verifyCount}\n`);

    await mongoose.disconnect();
    console.log('✅ Script complete!');
    console.log('💡 Note: The AvailableAssignment materialized view will be updated on the next job run (every 60 seconds)\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

makeCatiQcBatchEligible();






