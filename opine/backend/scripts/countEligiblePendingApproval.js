const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

async function countEligiblePendingApproval() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();

    // Get all Pending_Approval responses
    const totalPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval'
    });

    console.log(`📊 Total Pending_Approval responses (all time): ${totalPending}\n`);

    // Split by interview mode
    const capiTotal = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi'
    });

    const catiTotal = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'cati'
    });

    const otherTotal = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: { $nin: ['capi', 'cati'] }
    });

    console.log(`   CAPI: ${capiTotal}`);
    console.log(`   CATI: ${catiTotal}`);
    console.log(`   Other: ${otherTotal}\n`);

    // CAPI Eligibility Criteria
    console.log('🔍 Checking CAPI Eligibility...');
    const capiQuery = {
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
    };

    const capiEligible = await SurveyResponse.countDocuments(capiQuery);
    const capiIneligible = capiTotal - capiEligible;

    console.log(`   ✅ Eligible: ${capiEligible}`);
    console.log(`   ❌ Ineligible: ${capiIneligible}\n`);

    // Check individual CAPI criteria to see why they're ineligible
    const capiNoReviewAssignment = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { reviewAssignment: { $exists: false } },
        { 'reviewAssignment.assignedTo': null },
        { 'reviewAssignment.expiresAt': { $lt: now } }
      ]
    });

    const capiWithActiveAssignment = capiTotal - capiNoReviewAssignment;

    const capiNoAudio = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.hasAudio': { $ne: true } },
        { audioRecording: { $exists: false } }
      ]
    });

    const capiNoFileSize = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.fileSize': { $exists: false } },
        { 'audioRecording.fileSize': { $lte: 0 } }
      ]
    });

    const capiNoUploadedAt = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.uploadedAt': { $exists: false } },
        { 'audioRecording.uploadedAt': null }
      ]
    });

    // Check invalid audio URL (not matching S3 pattern)
    const capiWithAudioUrl = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $exists: true, $type: 'string' }
    });

    const capiWithValidS3Url = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $exists: true, $type: 'string', $regex: /^audio\/interviews\// }
    });

    const capiInvalidAudioUrl = capiWithAudioUrl - capiWithValidS3Url;

    const capiNoDuration = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.recordingDuration': { $exists: false } },
        { 'audioRecording.recordingDuration': { $lte: 0 } }
      ]
    });

    const capiLessThan3Responses = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'responses.2': { $exists: false }
    });

    console.log('   📋 CAPI Ineligibility Breakdown:');
    console.log(`      Active Review Assignment: ${capiWithActiveAssignment}`);
    console.log(`      No Audio Recording: ${capiNoAudio}`);
    console.log(`      No/Invalid File Size: ${capiNoFileSize}`);
    console.log(`      No Uploaded At: ${capiNoUploadedAt}`);
    console.log(`      Invalid Audio URL (not S3): ${capiInvalidAudioUrl}`);
    console.log(`      No/Invalid Duration: ${capiNoDuration}`);
    console.log(`      Less than 3 responses: ${capiLessThan3Responses}\n`);

    // CATI/Other Eligibility Criteria
    console.log('🔍 Checking CATI/Other Eligibility...');
    const catiQuery = {
      status: 'Pending_Approval',
      interviewMode: { $ne: 'capi' },
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
    };

    const catiEligible = await SurveyResponse.countDocuments(catiQuery);
    const catiIneligible = (catiTotal + otherTotal) - catiEligible;

    console.log(`   ✅ Eligible: ${catiEligible}`);
    console.log(`   ❌ Ineligible: ${catiIneligible}\n`);

    // Check individual CATI criteria
    const catiNoReviewAssignment = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: { $ne: 'capi' },
      $or: [
        { reviewAssignment: { $exists: false } },
        { 'reviewAssignment.assignedTo': null },
        { 'reviewAssignment.expiresAt': { $lt: now } }
      ]
    });

    const catiWithActiveAssignment = (catiTotal + otherTotal) - catiNoReviewAssignment;

    const catiWithQcBatch = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: { $ne: 'capi' },
      qcBatch: { $exists: true, $ne: null },
      isSampleResponse: { $ne: true }
    });

    console.log('   📋 CATI/Other Ineligibility Breakdown:');
    console.log(`      Active Review Assignment: ${catiWithActiveAssignment}`);
    console.log(`      Has QC Batch (not sample): ${catiWithQcBatch}\n`);

    // Summary
    const totalEligible = capiEligible + catiEligible;
    const totalIneligible = capiIneligible + catiIneligible;

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Pending_Approval: ${totalPending}`);
    console.log(`✅ Eligible for AvailableAssignment: ${totalEligible}`);
    console.log(`   - CAPI: ${capiEligible}`);
    console.log(`   - CATI/Other: ${catiEligible}`);
    console.log(`❌ Ineligible: ${totalIneligible}`);
    console.log(`   - CAPI: ${capiIneligible}`);
    console.log(`   - CATI/Other: ${catiIneligible}`);
    console.log('═══════════════════════════════════════════════════════════\n');

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

countEligiblePendingApproval();

