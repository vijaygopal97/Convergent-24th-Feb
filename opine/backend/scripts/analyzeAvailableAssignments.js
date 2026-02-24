/**
 * Analyze AvailableAssignment Materialized View
 * 
 * This script analyzes:
 * 1. How many CAPI and CATI assignments are in "Pending_Approval"
 * 2. How many are eligible and in the queue (AvailableAssignment)
 * 3. How many are ineligible
 * 4. The reasons count for ineligibility
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const AvailableAssignment = require('../models/AvailableAssignment');
const fs = require('fs');
const path = require('path');

async function analyzeAvailableAssignments() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 AvailableAssignment Analysis');
    console.log('═══════════════════════════════════════════════════════════\n');

    // ==========================================
    // 1. TOTAL PENDING_APPROVAL COUNTS
    // ==========================================
    console.log('1️⃣  TOTAL PENDING_APPROVAL RESPONSES\n');

    const totalPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval'
    });

    const capiPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi'
    });

    const catiPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'cati'
    });

    console.log(`   Total Pending_Approval: ${totalPending}`);
    console.log(`   ├─ CAPI: ${capiPending}`);
    console.log(`   └─ CATI: ${catiPending}\n`);

    // ==========================================
    // 2. AVAILABLEASSIGNMENT QUEUE COUNTS
    // ==========================================
    console.log('2️⃣  AVAILABLEASSIGNMENT QUEUE (Eligible & Available)\n');

    const totalInQueue = await AvailableAssignment.countDocuments({
      status: 'available'
    });

    const capiInQueue = await AvailableAssignment.countDocuments({
      status: 'available',
      interviewMode: 'capi'
    });

    const catiInQueue = await AvailableAssignment.countDocuments({
      status: 'available',
      interviewMode: 'cati'
    });

    const assignedInQueue = await AvailableAssignment.countDocuments({
      status: 'assigned'
    });

    const expiredInQueue = await AvailableAssignment.countDocuments({
      status: 'expired'
    });

    console.log(`   Total in Queue (available): ${totalInQueue}`);
    console.log(`   ├─ CAPI: ${capiInQueue}`);
    console.log(`   └─ CATI: ${catiInQueue}`);
    console.log(`   Assigned: ${assignedInQueue}`);
    console.log(`   Expired: ${expiredInQueue}\n`);

    // ==========================================
    // 3. ELIGIBILITY ANALYSIS - CAPI
    // ==========================================
    console.log('3️⃣  CAPI ELIGIBILITY ANALYSIS\n');

    // Fetch all CAPI Pending_Approval responses
    const capiResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'capi'
    })
      .select('_id reviewAssignment audioRecording responses')
      .read('secondaryPreferred')
      .maxTimeMS(60000)
      .lean();

    console.log(`   Analyzing ${capiResponses.length} CAPI responses...\n`);

    const capiEligibilityReasons = {
      eligible: 0,
      ineligible: 0,
      reasons: {
        'Active Review Assignment': 0,
        'No Audio Recording': 0,
        'Audio hasAudio = false': 0,
        'Audio fileSize missing or 0': 0,
        'Audio uploadedAt missing': 0,
        'Audio URL not S3 (not audio/interviews/)': 0,
        'Audio URL is local file (does not exist)': 0,
        'Audio recordingDuration missing or 0': 0,
        'Less than 3 responses': 0
      }
    };

    for (const response of capiResponses) {
      let isEligible = true;
      const reasons = [];

      // Check 1: Review Assignment
      if (response.reviewAssignment?.assignedTo && 
          response.reviewAssignment?.expiresAt && 
          new Date(response.reviewAssignment.expiresAt) >= now) {
        isEligible = false;
        reasons.push('Active Review Assignment');
        capiEligibilityReasons.reasons['Active Review Assignment']++;
      }

      // Check 2: Audio Recording exists
      if (!response.audioRecording) {
        isEligible = false;
        reasons.push('No Audio Recording');
        capiEligibilityReasons.reasons['No Audio Recording']++;
      } else {
        // Check 3: hasAudio
        if (!response.audioRecording.hasAudio) {
          isEligible = false;
          reasons.push('Audio hasAudio = false');
          capiEligibilityReasons.reasons['Audio hasAudio = false']++;
        }

        // Check 4: fileSize
        if (!response.audioRecording.fileSize || response.audioRecording.fileSize <= 0) {
          isEligible = false;
          reasons.push('Audio fileSize missing or 0');
          capiEligibilityReasons.reasons['Audio fileSize missing or 0']++;
        }

        // Check 5: uploadedAt
        if (!response.audioRecording.uploadedAt) {
          isEligible = false;
          reasons.push('Audio uploadedAt missing');
          capiEligibilityReasons.reasons['Audio uploadedAt missing']++;
        }

        // Check 6: audioUrl format (must be S3: audio/interviews/...)
        if (!response.audioRecording.audioUrl || typeof response.audioRecording.audioUrl !== 'string') {
          isEligible = false;
          reasons.push('Audio URL not S3 (not audio/interviews/)');
          capiEligibilityReasons.reasons['Audio URL not S3 (not audio/interviews/)']++;
        } else {
          const audioUrl = response.audioRecording.audioUrl;
          if (!audioUrl.match(/^audio\/interviews\//)) {
            // Check if it's a local file
            if (audioUrl.startsWith('/uploads/audio/')) {
              const fullPath = path.join(__dirname, '../../', audioUrl);
              if (!fs.existsSync(fullPath)) {
                isEligible = false;
                reasons.push('Audio URL is local file (does not exist)');
                capiEligibilityReasons.reasons['Audio URL is local file (does not exist)']++;
              } else {
                // Local file exists but not S3 format
                isEligible = false;
                reasons.push('Audio URL not S3 (not audio/interviews/)');
                capiEligibilityReasons.reasons['Audio URL not S3 (not audio/interviews/)']++;
              }
            } else {
              isEligible = false;
              reasons.push('Audio URL not S3 (not audio/interviews/)');
              capiEligibilityReasons.reasons['Audio URL not S3 (not audio/interviews/)']++;
            }
          }
        }

        // Check 7: recordingDuration
        if (!response.audioRecording.recordingDuration || response.audioRecording.recordingDuration <= 0) {
          isEligible = false;
          reasons.push('Audio recordingDuration missing or 0');
          capiEligibilityReasons.reasons['Audio recordingDuration missing or 0']++;
        }
      }

      // Check 8: Responses count (must have at least 3)
      const responsesCount = response.responses ? response.responses.length : 0;
      if (responsesCount < 3) {
        isEligible = false;
        reasons.push('Less than 3 responses');
        capiEligibilityReasons.reasons['Less than 3 responses']++;
      }

      if (isEligible) {
        capiEligibilityReasons.eligible++;
      } else {
        capiEligibilityReasons.ineligible++;
      }
    }

    console.log(`   ✅ Eligible: ${capiEligibilityReasons.eligible}`);
    console.log(`   ❌ Ineligible: ${capiEligibilityReasons.ineligible}`);
    console.log(`\n   Ineligibility Reasons (CAPI):`);
    for (const [reason, count] of Object.entries(capiEligibilityReasons.reasons)) {
      if (count > 0) {
        console.log(`   ├─ ${reason}: ${count}`);
      }
    }
    console.log('');

    // ==========================================
    // 4. ELIGIBILITY ANALYSIS - CATI
    // ==========================================
    console.log('4️⃣  CATI ELIGIBILITY ANALYSIS\n');

    // Fetch all CATI Pending_Approval responses
    const catiResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'cati'
    })
      .select('_id reviewAssignment qcBatch isSampleResponse')
      .read('secondaryPreferred')
      .maxTimeMS(60000)
      .lean();

    console.log(`   Analyzing ${catiResponses.length} CATI responses...\n`);

    const catiEligibilityReasons = {
      eligible: 0,
      ineligible: 0,
      reasons: {
        'Active Review Assignment': 0,
        'In QC Batch (not sample)': 0
      }
    };

    for (const response of catiResponses) {
      let isEligible = true;
      const reasons = [];

      // Check 1: Review Assignment
      if (response.reviewAssignment?.assignedTo && 
          response.reviewAssignment?.expiresAt && 
          new Date(response.reviewAssignment.expiresAt) >= now) {
        isEligible = false;
        reasons.push('Active Review Assignment');
        catiEligibilityReasons.reasons['Active Review Assignment']++;
      }

      // Check 2: QC Batch (must not be in qcBatch unless isSampleResponse = true)
      if (response.qcBatch && 
          response.qcBatch !== null && 
          (!response.isSampleResponse || response.isSampleResponse !== true)) {
        isEligible = false;
        reasons.push('In QC Batch (not sample)');
        catiEligibilityReasons.reasons['In QC Batch (not sample)']++;
      }

      if (isEligible) {
        catiEligibilityReasons.eligible++;
      } else {
        catiEligibilityReasons.ineligible++;
      }
    }

    console.log(`   ✅ Eligible: ${catiEligibilityReasons.eligible}`);
    console.log(`   ❌ Ineligible: ${catiEligibilityReasons.ineligible}`);
    console.log(`\n   Ineligibility Reasons (CATI):`);
    for (const [reason, count] of Object.entries(catiEligibilityReasons.reasons)) {
      if (count > 0) {
        console.log(`   ├─ ${reason}: ${count}`);
      }
    }
    console.log('');

    // ==========================================
    // 5. SUMMARY
    // ==========================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('CAPI:');
    console.log(`   Total Pending_Approval: ${capiPending}`);
    console.log(`   Eligible: ${capiEligibilityReasons.eligible}`);
    console.log(`   In Queue (AvailableAssignment): ${capiInQueue}`);
    console.log(`   Ineligible: ${capiEligibilityReasons.ineligible}`);
    console.log(`   Gap (Eligible - In Queue): ${capiEligibilityReasons.eligible - capiInQueue}\n`);

    console.log('CATI:');
    console.log(`   Total Pending_Approval: ${catiPending}`);
    console.log(`   Eligible: ${catiEligibilityReasons.eligible}`);
    console.log(`   In Queue (AvailableAssignment): ${catiInQueue}`);
    console.log(`   Ineligible: ${catiEligibilityReasons.ineligible}`);
    console.log(`   Gap (Eligible - In Queue): ${catiEligibilityReasons.eligible - catiInQueue}\n`);

    console.log('═══════════════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    console.log('✅ Analysis complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

analyzeAvailableAssignments();






