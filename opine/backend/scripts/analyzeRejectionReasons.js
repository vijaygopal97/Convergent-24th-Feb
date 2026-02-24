/**
 * Analyze rejection reasons from database and manual Excel files
 * Find which rejection reasons can be recovered
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Rejection reason code mapping
const REJECTION_REASON_MAP = {
  '1': 'Short Duration',
  '2': 'GPS Distance Too Far',
  '3': 'Duplicate Phone Number',
  '4': 'Audio Quality Doesn\'t Meet the Standard',
  '5': 'Gender Mismatch',
  '6': '2021 Assembly Elections Mismatch',
  '7': '2024 Lok Sabha Elections Mismatch',
  '8': 'Upcoming Elections Mismatch',
  '9': 'Interviewer Performance/Quality Issues'
};

// Audio status values that are VALID (don't trigger rejection)
const VALID_AUDIO_STATUSES = ['1', '4', '7'];

async function analyzeRejectionReasons() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Analyzing Rejection Reasons');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Get all rejected responses
    const rejectedResponses = await SurveyResponse.find({
      status: 'Rejected'
    })
      .select('_id responseId status verificationData interviewMode audioRecording createdAt')
      .read('secondaryPreferred')
      .maxTimeMS(300000)
      .lean();

    console.log(`📊 Total Rejected Responses: ${rejectedResponses.length}\n`);

    // Analyze rejection reasons
    const rejectionStats = {
      byCode: {},
      byAudioStatus: {},
      byInterviewMode: {},
      recoverable: {
        audioQuality: [],
        genderMismatch: [],
        electionsMismatch: [],
        interviewerPerformance: []
      },
      unrecoverable: {
        shortDuration: [],
        gpsDistance: [],
        duplicatePhone: []
      }
    };

    for (const response of rejectedResponses) {
      const verificationData = response.verificationData || {};
      const autoRejectionReasons = verificationData.autoRejectionReasons || [];
      const criteria = verificationData.criteria || verificationData.verificationCriteria || {};
      const feedback = verificationData.feedback || '';
      const feedbackLower = feedback.toLowerCase();

      // Determine rejection reason code
      let reasonCode = '';
      
      // Priority 1: Auto-rejection reasons
      if (autoRejectionReasons.length > 0) {
        if (autoRejectionReasons.includes('duration')) {
          reasonCode = '1';
        } else if (autoRejectionReasons.includes('gps_distance')) {
          reasonCode = '2';
        } else if (autoRejectionReasons.includes('duplicate_phone')) {
          reasonCode = '3';
        }
      }
      
      // Priority 2: Manual rejection criteria
      if (!reasonCode) {
        if (criteria.audioStatus !== null && criteria.audioStatus !== undefined && criteria.audioStatus !== '') {
          const audioStatus = String(criteria.audioStatus);
          if (!VALID_AUDIO_STATUSES.includes(audioStatus)) {
            reasonCode = '4';
          }
        }
        
        if (!reasonCode && criteria.genderMatching !== null && criteria.genderMatching !== undefined && criteria.genderMatching !== '') {
          const genderMatching = String(criteria.genderMatching);
          if (genderMatching !== '1') {
            reasonCode = '5';
          }
        }
        
        if (!reasonCode && criteria.previousElectionsMatching !== null && 
            criteria.previousElectionsMatching !== undefined && 
            criteria.previousElectionsMatching !== '') {
          const previousElectionsMatching = String(criteria.previousElectionsMatching);
          if (!['1', '3'].includes(previousElectionsMatching)) {
            reasonCode = '6';
          }
        }
        
        if (!reasonCode && criteria.previousLoksabhaElectionsMatching !== null && 
            criteria.previousLoksabhaElectionsMatching !== undefined && 
            criteria.previousLoksabhaElectionsMatching !== '') {
          const previousLoksabhaElectionsMatching = String(criteria.previousLoksabhaElectionsMatching);
          if (!['1', '3'].includes(previousLoksabhaElectionsMatching)) {
            reasonCode = '7';
          }
        }
        
        if (!reasonCode && criteria.upcomingElectionsMatching !== null && 
            criteria.upcomingElectionsMatching !== undefined && 
            criteria.upcomingElectionsMatching !== '') {
          const upcomingElectionsMatching = String(criteria.upcomingElectionsMatching);
          if (!['1', '3'].includes(upcomingElectionsMatching)) {
            reasonCode = '8';
          }
        }
      }
      
      // Priority 3: Feedback text
      if (!reasonCode && feedback) {
        if (feedbackLower.includes('interview too short') || 
            feedbackLower.includes('too short') ||
            feedbackLower.includes('short duration')) {
          reasonCode = '1';
        } else if (feedbackLower.includes('gps location too far') ||
            feedbackLower.includes('gps') && feedbackLower.includes('far') ||
            feedbackLower.includes('location too far') ||
            feedbackLower.includes('gps distance')) {
          reasonCode = '2';
        } else if (feedbackLower.includes('duplicate phone') ||
            feedbackLower.includes('duplicate phone number')) {
          reasonCode = '3';
        } else if (feedbackLower.includes('audio') && 
            (feedbackLower.includes('not') || feedbackLower.includes('cannot') || feedbackLower.includes('fail'))) {
          reasonCode = '4';
        } else if (feedbackLower.includes('gender') && 
            (feedbackLower.includes('mismatch') || feedbackLower.includes('not match'))) {
          reasonCode = '5';
        } else if ((feedbackLower.includes('2021') || feedbackLower.includes('assembly')) && 
            (feedbackLower.includes('mismatch') || feedbackLower.includes('not match'))) {
          reasonCode = '6';
        } else if ((feedbackLower.includes('2024') || feedbackLower.includes('lok sabha') || feedbackLower.includes('general election')) && 
            (feedbackLower.includes('mismatch') || feedbackLower.includes('not match'))) {
          reasonCode = '7';
        } else if ((feedbackLower.includes('2025') || feedbackLower.includes('preference') || feedbackLower.includes('pref')) && 
            (feedbackLower.includes('mismatch') || feedbackLower.includes('not match'))) {
          reasonCode = '8';
        } else if (feedbackLower.includes('interviewer performance') || 
            feedbackLower.includes('performance') ||
            feedbackLower.includes('quality') ||
            feedbackLower.includes('incomplete') ||
            feedbackLower.includes('poor quality') ||
            feedbackLower.includes('poor performance')) {
          reasonCode = '9';
        }
      }

      // Count by reason code
      if (!rejectionStats.byCode[reasonCode]) {
        rejectionStats.byCode[reasonCode] = {
          count: 0,
          samples: [],
          byInterviewMode: {}
        };
      }
      rejectionStats.byCode[reasonCode].count++;
      
      // Track by interview mode
      const mode = response.interviewMode || 'unknown';
      if (!rejectionStats.byCode[reasonCode].byInterviewMode[mode]) {
        rejectionStats.byCode[reasonCode].byInterviewMode[mode] = 0;
      }
      rejectionStats.byCode[reasonCode].byInterviewMode[mode]++;
      
      // Keep samples (first 5 per reason)
      if (rejectionStats.byCode[reasonCode].samples.length < 5) {
        rejectionStats.byCode[reasonCode].samples.push({
          responseId: response.responseId || response._id.toString(),
          _id: response._id.toString(),
          interviewMode: mode,
          audioStatus: criteria.audioStatus,
          feedback: feedback.substring(0, 100)
        });
      }

      // Track audio status details for code 4
      if (reasonCode === '4') {
        const audioStatus = String(criteria.audioStatus || 'unknown');
        if (!rejectionStats.byAudioStatus[audioStatus]) {
          rejectionStats.byAudioStatus[audioStatus] = 0;
        }
        rejectionStats.byAudioStatus[audioStatus]++;
        
        // Check if recoverable (has valid audio metadata)
        const audioRec = response.audioRecording || {};
        if (audioRec.hasAudio && audioRec.fileSize > 0 && audioRec.audioUrl) {
          rejectionStats.recoverable.audioQuality.push({
            responseId: response.responseId || response._id.toString(),
            audioStatus: audioStatus,
            hasAudio: audioRec.hasAudio,
            fileSize: audioRec.fileSize,
            audioUrl: audioRec.audioUrl
          });
        }
      }

      // Track by interview mode
      if (!rejectionStats.byInterviewMode[mode]) {
        rejectionStats.byInterviewMode[mode] = 0;
      }
      rejectionStats.byInterviewMode[mode]++;

      // Categorize recoverable vs unrecoverable
      if (reasonCode === '4') {
        // Audio quality - potentially recoverable if audio exists
        const audioRec = response.audioRecording || {};
        if (audioRec.hasAudio && audioRec.fileSize > 0) {
          rejectionStats.recoverable.audioQuality.push({
            responseId: response.responseId || response._id.toString(),
            audioStatus: criteria.audioStatus
          });
        }
      } else if (reasonCode === '5') {
        // Gender mismatch - potentially recoverable (QC judgment)
        rejectionStats.recoverable.genderMismatch.push({
          responseId: response.responseId || response._id.toString()
        });
      } else if (['6', '7', '8'].includes(reasonCode)) {
        // Elections mismatch - potentially recoverable (QC judgment)
        rejectionStats.recoverable.electionsMismatch.push({
          responseId: response.responseId || response._id.toString(),
          reasonCode: reasonCode
        });
      } else if (reasonCode === '9') {
        // Interviewer performance - potentially recoverable (QC judgment)
        rejectionStats.recoverable.interviewerPerformance.push({
          responseId: response.responseId || response._id.toString()
        });
      } else if (reasonCode === '1') {
        // Short duration - usually unrecoverable
        rejectionStats.unrecoverable.shortDuration.push({
          responseId: response.responseId || response._id.toString()
        });
      } else if (reasonCode === '2') {
        // GPS distance - usually unrecoverable
        rejectionStats.unrecoverable.gpsDistance.push({
          responseId: response.responseId || response._id.toString()
        });
      } else if (reasonCode === '3') {
        // Duplicate phone - usually unrecoverable
        rejectionStats.unrecoverable.duplicatePhone.push({
          responseId: response.responseId || response._id.toString()
        });
      }
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Rejection Reasons Breakdown');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const [code, reason] of Object.entries(REJECTION_REASON_MAP)) {
      const stats = rejectionStats.byCode[code] || { count: 0, byInterviewMode: {}, samples: [] };
      console.log(`${code}. ${reason}: ${stats.count}`);
      
      if (Object.keys(stats.byInterviewMode).length > 0) {
        console.log(`   By Mode:`, stats.byInterviewMode);
      }
      
      if (code === '4') {
        console.log(`   Audio Status Values:`);
        for (const [status, count] of Object.entries(rejectionStats.byAudioStatus)) {
          console.log(`      Status "${status}": ${count}`);
        }
      }
      
      if (stats.samples.length > 0) {
        console.log(`   Sample Response IDs:`);
        stats.samples.forEach((s, idx) => {
          console.log(`      ${idx + 1}. ${s.responseId} (${s.interviewMode})`);
          if (code === '4') {
            console.log(`         Audio Status: ${s.audioStatus}`);
          }
        });
      }
      console.log('');
    }

    // Recoverability analysis
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔄 Recoverability Analysis');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('✅ Potentially Recoverable:');
    console.log(`   Audio Quality (Code 4): ${rejectionStats.recoverable.audioQuality.length}`);
    console.log(`   Gender Mismatch (Code 5): ${rejectionStats.recoverable.genderMismatch.length}`);
    console.log(`   Elections Mismatch (Codes 6,7,8): ${rejectionStats.recoverable.electionsMismatch.length}`);
    console.log(`   Interviewer Performance (Code 9): ${rejectionStats.recoverable.interviewerPerformance.length}`);
    const totalRecoverable = rejectionStats.recoverable.audioQuality.length +
                             rejectionStats.recoverable.genderMismatch.length +
                             rejectionStats.recoverable.electionsMismatch.length +
                             rejectionStats.recoverable.interviewerPerformance.length;
    console.log(`   Total Potentially Recoverable: ${totalRecoverable}\n`);

    console.log('❌ Usually Unrecoverable:');
    console.log(`   Short Duration (Code 1): ${rejectionStats.unrecoverable.shortDuration.length}`);
    console.log(`   GPS Distance (Code 2): ${rejectionStats.unrecoverable.gpsDistance.length}`);
    console.log(`   Duplicate Phone (Code 3): ${rejectionStats.unrecoverable.duplicatePhone.length}`);
    const totalUnrecoverable = rejectionStats.unrecoverable.shortDuration.length +
                               rejectionStats.unrecoverable.gpsDistance.length +
                               rejectionStats.unrecoverable.duplicatePhone.length;
    console.log(`   Total Usually Unrecoverable: ${totalUnrecoverable}\n`);

    // Audio Quality detailed analysis
    if (rejectionStats.byCode['4']) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🎵 Audio Quality Rejection (Code 4) - Detailed Analysis');
      console.log('═══════════════════════════════════════════════════════════\n');
      
      console.log(`Total Rejected for Audio Quality: ${rejectionStats.byCode['4'].count}`);
      console.log(`With Valid Audio Metadata (Potentially Recoverable): ${rejectionStats.recoverable.audioQuality.length}`);
      console.log(`Without Valid Audio Metadata: ${rejectionStats.byCode['4'].count - rejectionStats.recoverable.audioQuality.length}\n`);
      
      console.log('Audio Status Values Breakdown:');
      for (const [status, count] of Object.entries(rejectionStats.byAudioStatus)) {
        const percentage = ((count / rejectionStats.byCode['4'].count) * 100).toFixed(2);
        console.log(`   Status "${status}": ${count} (${percentage}%)`);
      }
      console.log('');
      
      console.log('Note: Audio Status values "1", "4", "7" are VALID.');
      console.log('      Any other value triggers "Audio Quality Doesn\'t Meet the Standard" rejection.\n');
    }

    // Export sample recoverable response IDs
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 Sample Recoverable Response IDs');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (rejectionStats.recoverable.audioQuality.length > 0) {
      console.log('Audio Quality (first 10):');
      rejectionStats.recoverable.audioQuality.slice(0, 10).forEach((r, idx) => {
        console.log(`   ${idx + 1}. ${r.responseId} (Status: ${r.audioStatus})`);
      });
      console.log('');
    }

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

analyzeRejectionReasons();





