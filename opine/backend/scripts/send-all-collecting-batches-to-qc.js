/**
 * Send all batches in "collecting" status to QC
 * This is equivalent to pressing "Send to QC" for every batch in collecting state
 * It will process batches and set isSampleResponse: true for sample responses
 */

require('dotenv').config();
const mongoose = require('mongoose');
const QCBatch = require('../models/QCBatch');
const QCBatchConfig = require('../models/QCBatchConfig');
const Survey = require('../models/Survey');
const Company = require('../models/Company'); // Required for populate
const User = require('../models/User'); // Required for populate
const { processBatch } = require('../jobs/qcBatchProcessor');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function sendAllCollectingBatchesToQC() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    // Get survey to get company ID
    const survey = await Survey.findById(SURVEY_ID).populate('company');
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }

    const companyId = survey.company._id || survey.company;

    // Get active config
    const config = await QCBatchConfig.getActiveConfig(SURVEY_ID, companyId);
    if (!config) {
      throw new Error('No active QC batch configuration found for this survey');
    }

    console.log(`📋 Using config: ${config._id} (${config.samplePercentage}% sample)\n`);

    // Find all batches in collecting status
    const collectingBatches = await QCBatch.find({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'collecting'
    })
    .lean();

    console.log(`📊 Found ${collectingBatches.length} batches in "collecting" status\n`);

    if (collectingBatches.length === 0) {
      console.log('✅ No batches to process\n');
      await mongoose.disconnect();
      process.exit(0);
    }

    let successCount = 0;
    let errorCount = 0;

    // Process each batch
    for (let i = 0; i < collectingBatches.length; i++) {
      const batch = collectingBatches[i];
      console.log(`\n[${i + 1}/${collectingBatches.length}] Processing batch ${batch._id}`);
      console.log(`   Interviewer ID: ${batch.interviewer}`);
      console.log(`   Total Responses: ${batch.totalResponses}`);
      console.log(`   Status: ${batch.status}`);

      try {
        // Convert lean object back to Mongoose document
        const batchDoc = await QCBatch.findById(batch._id);
        
        if (!batchDoc) {
          console.log(`   ⚠️  Batch not found, skipping...`);
          errorCount++;
          continue;
        }

        // Check if batch has responses
        if (batchDoc.totalResponses === 0) {
          console.log(`   ⚠️  Batch has no responses, skipping...`);
          errorCount++;
          continue;
        }

        // Process the batch (same as "Send to QC" button)
        await processBatch(batchDoc, config);

        console.log(`   ✅ Batch processed successfully`);
        console.log(`   📊 Sample size: ${batchDoc.sampleSize || 0}`);
        console.log(`   📊 Remaining size: ${batchDoc.remainingSize || 0}`);
        console.log(`   📊 New status: ${batchDoc.status}`);

        successCount++;
      } catch (error) {
        console.error(`   ❌ Error processing batch: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total batches: ${collectingBatches.length}`);
    console.log(`   ✅ Successfully processed: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Verify batches are no longer in collecting status
    const stillCollecting = await QCBatch.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'collecting'
    });

    console.log(`📊 Verification: ${stillCollecting} batches still in "collecting" status\n`);

    await mongoose.disconnect();
    console.log('✅ All collecting batches sent to QC!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

sendAllCollectingBatchesToQC();

