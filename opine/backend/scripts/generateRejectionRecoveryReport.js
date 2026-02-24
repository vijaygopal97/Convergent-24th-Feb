/**
 * Comprehensive Rejection Recovery Report
 * Analyzes all rejection reasons and identifies recoverable responses
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

// Audio Status Values:
// 1 = Survey Conversation can be heard (VALID - doesn't reject)
// 2 = No Conversation (INVALID - rejects)
// 3 = Irrelevant Conversation (INVALID - rejects)
// 4 = Can hear interviewer more than respondent (VALID - doesn't reject)
// 7 = Cannot hear the response clearly (VALID - doesn't reject)
// 8 = Interviewer acting as respondent (INVALID - rejects)
// 9 = Other issues (INVALID - rejects)

const VALID_AUDIO_STATUSES = ['1', '4', '7'];
const INVALID_AUDIO_STATUSES = ['2', '3', '8', '9'];

async function generateRejectionRecoveryReport() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Comprehensive Rejection Recovery Analysis');
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

    const analysis = {
      byReasonCode: {},
      audioQuality: {
        total: 0,
        byStatus: {},
        withAudio: 0,
        withoutAudio: 0,
        recoverable: []
      },
      recoverable: {
        audioQuality: 0,
        genderMismatch: 0,
        electionsMismatch: 0,
        fraudInterview: 0
      },
      unrecoverable: {
        shortDuration: 0,
        gpsDistance: 0,
        duplicatePhone: 0
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
            
            // Track audio quality details
            analysis.audioQuality.total++;
            if (!analysis.audioQuality.byStatus[audioStatus]) {
              analysis.audioQuality.byStatus[audioStatus] = 0;
            }
            analysis.audioQuality.byStatus[audioStatus]++;
            
            const audioRec = response.audioRecording || {};
            if (audioRec.hasAudio && audioRec.fileSize > 0 && audioRec.audioUrl) {
              analysis.audioQuality.withAudio++;
              // Check if audio URL is valid S3
              if (audioRec.audioUrl.startsWith('audio/interviews/')) {
                analysis.audioQuality.recoverable.push({
                  responseId: response.responseId || response._id.toString(),
                  audioStatus: audioStatus,
                  hasAudio: true,
                  fileSize: audioRec.fileSize,
                  audioUrl: audioRec.audioUrl
                });
                analysis.recoverable.audioQuality++;
              } else {
                analysis.audioQuality.withoutAudio++;
              }
            } else {
              analysis.audioQuality.withoutAudio++;
            }
          }
        }
        
        if (!reasonCode && criteria.genderMatching !== null && criteria.genderMatching !== undefined && criteria.genderMatching !== '') {
          const genderMatching = String(criteria.genderMatching);
          if (genderMatching !== '1') {
            reasonCode = '5';
            analysis.recoverable.genderMismatch++;
          }
        }
        
        if (!reasonCode && criteria.previousElectionsMatching !== null && 
            criteria.previousElectionsMatching !== undefined && 
            criteria.previousElectionsMatching !== '') {
          const previousElectionsMatching = String(criteria.previousElectionsMatching);
          if (!['1', '3'].includes(previousElectionsMatching)) {
            reasonCode = '6';
            analysis.recoverable.electionsMismatch++;
          }
        }
        
        if (!reasonCode && criteria.previousLoksabhaElectionsMatching !== null && 
            criteria.previousLoksabhaElectionsMatching !== undefined && 
            criteria.previousLoksabhaElectionsMatching !== '') {
          const previousLoksabhaElectionsMatching = String(criteria.previousLoksabhaElectionsMatching);
          if (!['1', '3'].includes(previousLoksabhaElectionsMatching)) {
            reasonCode = '7';
            analysis.recoverable.electionsMismatch++;
          }
        }
        
        if (!reasonCode && criteria.upcomingElectionsMatching !== null && 
            criteria.upcomingElectionsMatching !== undefined && 
            criteria.upcomingElectionsMatching !== '') {
          const upcomingElectionsMatching = String(criteria.upcomingElectionsMatching);
          if (!['1', '3'].includes(upcomingElectionsMatching)) {
            reasonCode = '8';
            analysis.recoverable.electionsMismatch++;
          }
        }
      }
      
      // Priority 3: Feedback text
      if (!reasonCode && feedback) {
        if (feedbackLower.includes('fraud') || feedbackLower.includes('fraudulent')) {
          reasonCode = 'fraud';
          analysis.recoverable.fraudInterview++;
        } else if (feedbackLower.includes('interview too short') || 
            feedbackLower.includes('too short') ||
            feedbackLower.includes('short duration')) {
          reasonCode = '1';
          analysis.unrecoverable.shortDuration++;
        } else if (feedbackLower.includes('gps location too far') ||
            feedbackLower.includes('gps') && feedbackLower.includes('far') ||
            feedbackLower.includes('location too far') ||
            feedbackLower.includes('gps distance')) {
          reasonCode = '2';
          analysis.unrecoverable.gpsDistance++;
        } else if (feedbackLower.includes('duplicate phone') ||
            feedbackLower.includes('duplicate phone number')) {
          reasonCode = '3';
          analysis.unrecoverable.duplicatePhone++;
        }
      }

      // Count by reason code
      if (!analysis.byReasonCode[reasonCode]) {
        analysis.byReasonCode[reasonCode] = 0;
      }
      analysis.byReasonCode[reasonCode]++;
    }

    // Display comprehensive report
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 Rejection Reasons Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    const reasonMap = {
      '1': 'Short Duration',
      '2': 'GPS Distance Too Far',
      '3': 'Duplicate Phone Number',
      '4': 'Audio Quality Doesn\'t Meet the Standard',
      '5': 'Gender Mismatch',
      '6': '2021 Assembly Elections Mismatch',
      '7': '2024 Lok Sabha Elections Mismatch',
      '8': 'Upcoming Elections Mismatch',
      '9': 'Interviewer Performance/Quality Issues',
      'fraud': 'Fraud Interview'
    };

    for (const [code, count] of Object.entries(analysis.byReasonCode).sort((a, b) => b[1] - a[1])) {
      const reason = reasonMap[code] || `Unknown (${code})`;
      console.log(`${code}. ${reason}: ${count}`);
    }
    console.log('');

    // Audio Quality Detailed Analysis
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎵 Audio Quality Rejection (Code 4) - Detailed Analysis');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`Total Rejected for Audio Quality: ${analysis.audioQuality.total}`);
    console.log(`\nAudio Status Breakdown:`);
    for (const [status, count] of Object.entries(analysis.audioQuality.byStatus).sort((a, b) => b[1] - a[1])) {
      const percentage = ((count / analysis.audioQuality.total) * 100).toFixed(2);
      const statusText = {
        '2': 'No Conversation',
        '3': 'Irrelevant Conversation',
        '8': 'Interviewer acting as respondent',
        '9': 'Other issues',
        'unknown': 'Status not set (likely old data)'
      }[status] || `Status ${status}`;
      console.log(`   Status "${status}" (${statusText}): ${count} (${percentage}%)`);
    }

    console.log(`\nAudio File Status:`);
    console.log(`   With Valid Audio (hasAudio=true, fileSize>0): ${analysis.audioQuality.withAudio}`);
    console.log(`   Without Valid Audio: ${analysis.audioQuality.withoutAudio}`);
    console.log(`   With Valid S3 Audio URL (Recoverable): ${analysis.recoverable.audioQuality}`);
    console.log(`   Without Valid S3 Audio URL: ${analysis.audioQuality.withAudio - analysis.recoverable.audioQuality}`);

    console.log(`\n📝 When "Audio Quality Doesn't Meet the Standard" is Triggered:`);
    console.log(`   - Audio Status is NOT one of: "1", "4", or "7"`);
    console.log(`   - Valid statuses: "1" (conversation heard), "4" (interviewer louder), "7" (cannot hear clearly)`);
    console.log(`   - Invalid statuses: "2" (no conversation), "3" (irrelevant), "8" (interviewer as respondent), "9" (other)`);
    console.log(`   - If audioStatus is null/undefined but feedback mentions audio issues, it may also trigger\n`);

    // Recoverability Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔄 Recoverability Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('✅ Potentially Recoverable (QC Judgment - can be re-reviewed):');
    console.log(`   Audio Quality (Code 4) with Valid S3 Audio: ${analysis.recoverable.audioQuality}`);
    console.log(`   Gender Mismatch (Code 5): ${analysis.recoverable.genderMismatch}`);
    console.log(`   Elections Mismatch (Codes 6,7,8): ${analysis.recoverable.electionsMismatch}`);
    console.log(`   Fraud Interview (may need investigation): ${analysis.recoverable.fraudInterview}`);
    const totalRecoverable = analysis.recoverable.audioQuality +
                             analysis.recoverable.genderMismatch +
                             analysis.recoverable.electionsMismatch +
                             analysis.recoverable.fraudInterview;
    console.log(`   Total Potentially Recoverable: ${totalRecoverable}\n`);

    console.log('❌ Usually Unrecoverable (Hard Constraints):');
    console.log(`   Short Duration (Code 1): ${analysis.unrecoverable.shortDuration}`);
    console.log(`   GPS Distance (Code 2): ${analysis.unrecoverable.gpsDistance}`);
    console.log(`   Duplicate Phone (Code 3): ${analysis.unrecoverable.duplicatePhone}`);
    const totalUnrecoverable = analysis.unrecoverable.shortDuration +
                               analysis.unrecoverable.gpsDistance +
                               analysis.unrecoverable.duplicatePhone;
    console.log(`   Total Usually Unrecoverable: ${totalUnrecoverable}\n`);

    // Sample recoverable response IDs
    if (analysis.audioQuality.recoverable.length > 0) {
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📝 Sample Recoverable Audio Quality Response IDs (first 10)');
      console.log('═══════════════════════════════════════════════════════════\n');
      analysis.audioQuality.recoverable.slice(0, 10).forEach((r, idx) => {
        console.log(`${idx + 1}. ${r.responseId} (Status: ${r.audioStatus}, FileSize: ${r.fileSize} bytes)`);
      });
      console.log('');
    }

    await mongoose.disconnect();
    console.log('✅ Report generation complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

generateRejectionRecoveryReport();





