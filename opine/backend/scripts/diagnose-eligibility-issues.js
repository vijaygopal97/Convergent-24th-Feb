/**
 * Diagnose why responses are not eligible for QC
 * Shows detailed breakdown of failing conditions
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function diagnoseEligibility() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();

    // Get all Pending_Approval responses
    const totalPending = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval'
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 DIAGNOSIS: Why responses are not eligible for QC');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Total Pending_Approval responses: ${totalPending}\n`);

    // ========== CAPI ANALYSIS ==========
    console.log('🔍 CAPI RESPONSES ANALYSIS:');
    console.log('───────────────────────────────────────────────────────────\n');

    const totalCAPI = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi'
    });

    console.log(`   Total CAPI Pending_Approval: ${totalCAPI}\n`);

    // Check reviewAssignment blocking
    const capiWithActiveAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    const capiWithExpiredAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      reviewAssignment: { $exists: true },
      'reviewAssignment.expiresAt': { $lt: now }
    });

    const capiNoAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { reviewAssignment: { $exists: false } },
        { 'reviewAssignment.assignedTo': null },
        { 'reviewAssignment.expiresAt': { $lt: now } }
      ]
    });

    console.log(`   Review Assignment Status:`);
    console.log(`   ├─ With Active Assignment: ${capiWithActiveAssignment}`);
    console.log(`   ├─ With Expired Assignment: ${capiWithExpiredAssignment}`);
    console.log(`   └─ No/Expired Assignment: ${capiNoAssignment}\n`);

    // Check audio requirements
    const capiNoHasAudio = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.hasAudio': { $ne: true } },
        { 'audioRecording.hasAudio': { $exists: false } }
      ]
    });

    const capiNoFileSize = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.fileSize': { $exists: false } },
        { 'audioRecording.fileSize': { $lte: 0 } }
      ]
    });

    const capiNoUploadedAt = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.uploadedAt': { $exists: false } },
        { 'audioRecording.uploadedAt': null }
      ]
    });

    // Check S3 audio URL pattern
    const capiNoS3Url = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.audioUrl': { $exists: false } },
        { 'audioRecording.audioUrl': { $not: { $regex: /^audio\/interviews\// } } }
      ]
    });

    const capiNoDuration = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { 'audioRecording.recordingDuration': { $exists: false } },
        { 'audioRecording.recordingDuration': { $lte: 0 } }
      ]
    });

    // Check minimum responses count
    const capiLessThan3Responses = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'responses.2': { $exists: false }
    });

    console.log(`   Audio Requirements:`);
    console.log(`   ├─ Missing hasAudio: ${capiNoHasAudio}`);
    console.log(`   ├─ Missing/Invalid fileSize: ${capiNoFileSize}`);
    console.log(`   ├─ Missing uploadedAt: ${capiNoUploadedAt}`);
    console.log(`   ├─ Missing/Invalid S3 audioUrl (must start with "audio/interviews/"): ${capiNoS3Url}`);
    console.log(`   ├─ Missing/Invalid recordingDuration: ${capiNoDuration}`);
    console.log(`   └─ Less than 3 responses: ${capiLessThan3Responses}\n`);

    // Get sample of CAPI responses to see actual audio URL patterns
    const capiSamples = await SurveyResponse.find({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi'
    })
    .select('audioRecording.audioUrl audioRecording.hasAudio audioRecording.fileSize audioRecording.recordingDuration responses reviewAssignment')
    .limit(10)
    .lean();

    console.log(`   Sample CAPI Audio URLs (first 10):`);
    capiSamples.forEach((resp, idx) => {
      const audioUrl = resp.audioRecording?.audioUrl || 'MISSING';
      const hasAudio = resp.audioRecording?.hasAudio || false;
      const fileSize = resp.audioRecording?.fileSize || 0;
      const duration = resp.audioRecording?.recordingDuration || 0;
      const responseCount = resp.responses?.length || 0;
      const hasAssignment = resp.reviewAssignment?.assignedTo ? 'YES' : 'NO';
      console.log(`   ${idx + 1}. URL: ${audioUrl.substring(0, 80)}${audioUrl.length > 80 ? '...' : ''}`);
      console.log(`      hasAudio: ${hasAudio}, fileSize: ${fileSize}, duration: ${duration}, responses: ${responseCount}, assignment: ${hasAssignment}`);
    });
    console.log('');

    // ========== CATI ANALYSIS ==========
    console.log('🔍 CATI RESPONSES ANALYSIS:');
    console.log('───────────────────────────────────────────────────────────\n');

    const totalCATI = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati'
    });

    console.log(`   Total CATI Pending_Approval: ${totalCATI}\n`);

    // Check reviewAssignment blocking
    const catiWithActiveAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    const catiNoAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      $or: [
        { reviewAssignment: { $exists: false } },
        { 'reviewAssignment.assignedTo': null },
        { 'reviewAssignment.expiresAt': { $lt: now } }
      ]
    });

    console.log(`   Review Assignment Status:`);
    console.log(`   ├─ With Active Assignment: ${catiWithActiveAssignment}`);
    console.log(`   └─ No/Expired Assignment: ${catiNoAssignment}\n`);

    // Check QC Batch blocking (CRITICAL for CATI)
    const catiInQCBatch = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      qcBatch: { $exists: true, $ne: null },
      isSampleResponse: { $ne: true }
    });

    const catiNotInQCBatch = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      $or: [
        { qcBatch: { $exists: false } },
        { qcBatch: null },
        { isSampleResponse: true }
      ]
    });

    console.log(`   QC Batch Status:`);
    console.log(`   ├─ In QC Batch (blocking): ${catiInQCBatch}`);
    console.log(`   └─ Not in QC Batch (eligible): ${catiNotInQCBatch}\n`);

    // Check QC Batch collecting state
    const catiInCollectingBatch = await SurveyResponse.aggregate([
      {
        $match: {
          survey: new mongoose.Types.ObjectId(SURVEY_ID),
          status: 'Pending_Approval',
          interviewMode: 'cati',
          qcBatch: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'qcbatches',
          localField: 'qcBatch',
          foreignField: '_id',
          as: 'batchInfo'
        }
      },
      {
        $unwind: { path: '$batchInfo', preserveNullAndEmptyArrays: true }
      },
      {
        $match: {
          'batchInfo.status': 'collecting'
        }
      },
      {
        $count: 'count'
      }
    ]);

    const collectingCount = catiInCollectingBatch[0]?.count || 0;

    console.log(`   QC Batch Details:`);
    console.log(`   └─ In "collecting" state batches: ${collectingCount}\n`);

    // Get sample of CATI responses
    const catiSamples = await SurveyResponse.find({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati'
    })
    .select('qcBatch isSampleResponse reviewAssignment')
    .limit(10)
    .lean();

    console.log(`   Sample CATI QC Batch Status (first 10):`);
    catiSamples.forEach((resp, idx) => {
      const qcBatch = resp.qcBatch ? 'YES' : 'NO';
      const isSample = resp.isSampleResponse ? 'YES' : 'NO';
      const hasAssignment = resp.reviewAssignment?.assignedTo ? 'YES' : 'NO';
      console.log(`   ${idx + 1}. qcBatch: ${qcBatch}, isSample: ${isSample}, assignment: ${hasAssignment}`);
    });
    console.log('');

    // ========== FINAL ELIGIBILITY CHECK ==========
    console.log('✅ FINAL ELIGIBILITY CHECK:');
    console.log('───────────────────────────────────────────────────────────\n');

    // CAPI eligible
    const capiEligible = await SurveyResponse.countDocuments({
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

    // CATI eligible
    const catiEligible = await SurveyResponse.countDocuments({
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

    console.log(`   CAPI Eligible: ${capiEligible}`);
    console.log(`   CATI Eligible: ${catiEligible}\n`);

    await mongoose.disconnect();
    console.log('✅ Diagnosis complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

diagnoseEligibility();

