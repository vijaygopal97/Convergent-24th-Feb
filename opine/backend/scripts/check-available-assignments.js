/**
 * Check AvailableAssignment Materialized View
 * Shows how many eligible responses are available for CAPI and CATI QC
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AvailableAssignment = require('../models/AvailableAssignment');
const SurveyResponse = require('../models/SurveyResponse');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkAvailableAssignments() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    // Check AvailableAssignment counts
    console.log('📊 Checking AvailableAssignment Materialized View...\n');
    
    const totalAvailable = await AvailableAssignment.countDocuments({
      status: 'available',
      surveyId: new mongoose.Types.ObjectId(SURVEY_ID)
    });

    const capiAvailable = await AvailableAssignment.countDocuments({
      status: 'available',
      surveyId: new mongoose.Types.ObjectId(SURVEY_ID),
      interviewMode: 'capi'
    });

    const catiAvailable = await AvailableAssignment.countDocuments({
      status: 'available',
      surveyId: new mongoose.Types.ObjectId(SURVEY_ID),
      interviewMode: 'cati'
    });

    const assigned = await AvailableAssignment.countDocuments({
      status: 'assigned',
      surveyId: new mongoose.Types.ObjectId(SURVEY_ID)
    });

    const expired = await AvailableAssignment.countDocuments({
      status: 'expired',
      surveyId: new mongoose.Types.ObjectId(SURVEY_ID)
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 AvailableAssignment Materialized View Status');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total Available: ${totalAvailable}`);
    console.log(`   ├─ CAPI Available: ${capiAvailable}`);
    console.log(`   └─ CATI Available: ${catiAvailable}`);
    console.log(`   Assigned: ${assigned}`);
    console.log(`   Expired: ${expired}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Check actual SurveyResponse counts for validation
    console.log('🔍 Validating against actual SurveyResponse counts...\n');
    
    const now = new Date();
    
    // CAPI eligible responses (with valid audio)
    const capiEligibleCount = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $and: [
        {
          $or: [
            { reviewAssignment: { $exists: false } },
            { 'reviewAssignment.assignedTo': null },
            { 'reviewAssignment.expiresAt': { $lt: now } }
          ]
        }
      ],
      'audioRecording.hasAudio': true,
      'audioRecording.fileSize': { $exists: true, $gt: 0 },
      'audioRecording.uploadedAt': { $exists: true, $ne: null },
      'audioRecording.audioUrl': { $exists: true, $type: 'string', $regex: /^audio\/interviews\// },
      'audioRecording.recordingDuration': { $exists: true, $gt: 0 },
      'responses.2': { $exists: true }
    });

    // CATI eligible responses
    const catiEligibleCount = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      $and: [
        {
          $or: [
            { reviewAssignment: { $exists: false } },
            { 'reviewAssignment.assignedTo': null },
            { 'reviewAssignment.expiresAt': { $lt: now } }
          ]
        },
        {
          $or: [
            { qcBatch: { $exists: false } },
            { qcBatch: null },
            { isSampleResponse: true }
          ]
        }
      ]
    });

    const totalPendingApproval = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval'
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 Actual SurveyResponse Counts (Eligible for QC)');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total Pending_Approval: ${totalPendingApproval}`);
    console.log(`   ├─ CAPI Eligible (with valid audio): ${capiEligibleCount}`);
    console.log(`   └─ CATI Eligible: ${catiEligibleCount}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Comparison
    console.log('📊 Comparison (AvailableAssignment vs Actual):');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   CAPI: ${capiAvailable} in view vs ${capiEligibleCount} actual (diff: ${capiAvailable - capiEligibleCount})`);
    console.log(`   CATI: ${catiAvailable} in view vs ${catiEligibleCount} actual (diff: ${catiAvailable - catiEligibleCount})`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Check for test data contamination
    console.log('🧹 Checking for test data contamination...\n');
    const testDataCount = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      'metadata.testMarker': { $exists: true }
    });

    if (testDataCount > 0) {
      console.log(`⚠️  WARNING: Found ${testDataCount} test responses with testMarker in metadata`);
      console.log('   These should be cleaned up!\n');
    } else {
      console.log('✅ No test data contamination found\n');
    }

    await mongoose.disconnect();
    console.log('✅ Check complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkAvailableAssignments();


