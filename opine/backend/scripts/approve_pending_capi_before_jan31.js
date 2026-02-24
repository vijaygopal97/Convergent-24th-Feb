#!/usr/bin/env node

/**
 * Approve Pending Approval CAPI Responses Before January 31st, 2026
 * 
 * This script:
 * 1. Finds all CAPI responses in "Pending_Approval" status with startTime before Jan 31, 2026
 * 2. Approves them using the same approval method as other approved responses
 * 3. Creates a detailed report of the changes for potential rollback
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const REFERENCE_REVIEWER_IDS = [
  '68fe8b6239b5a3a70225b17b', // Primary reference user
  '6933f9885f41617a76fd50af'  // Alternative reference user
];
const APPROVER_ID = '68fe8b6239b5a3a70225b17b'; // User ID to use for approval
const JAN31_2026 = new Date('2026-01-31T23:59:59.999Z');

/**
 * Find example approval to replicate the pattern
 */
const findExampleApproval = async () => {
  try {
    console.log('🔍 Finding example approval by reference users...\n');
    
    // Try to find approval by primary reference user first
    let exampleResponse = await SurveyResponse.findOne({
      'verificationData.reviewer': new mongoose.Types.ObjectId(REFERENCE_REVIEWER_IDS[0]),
      status: 'Approved'
    })
    .sort({ 'verificationData.reviewedAt': -1 })
    .limit(1)
    .lean();

    // If not found, try the alternative reference user
    if (!exampleResponse || !exampleResponse.verificationData) {
      console.log(`   Trying alternative reference user: ${REFERENCE_REVIEWER_IDS[1]}...`);
      exampleResponse = await SurveyResponse.findOne({
        'verificationData.reviewer': new mongoose.Types.ObjectId(REFERENCE_REVIEWER_IDS[1]),
        status: 'Approved'
      })
      .sort({ 'verificationData.reviewedAt': -1 })
      .limit(1)
      .lean();
    }

    if (!exampleResponse || !exampleResponse.verificationData) {
      console.log('⚠️  No example approval found. Using default verification criteria.\n');
      return null;
    }

    console.log('✅ Found example approval:');
    console.log(`   Response ID: ${exampleResponse.responseId || exampleResponse._id}`);
    console.log(`   Reviewer: ${exampleResponse.verificationData.reviewer}`);
    console.log(`   Reviewed At: ${exampleResponse.verificationData.reviewedAt}`);
    console.log(`   Criteria:`, JSON.stringify(exampleResponse.verificationData.criteria, null, 2));
    console.log(`   Feedback: ${exampleResponse.verificationData.feedback || 'N/A'}\n`);

    return exampleResponse.verificationData;
  } catch (error) {
    console.error('❌ Error finding example approval:', error);
    return null;
  }
};

/**
 * Get default verification criteria (typical approval values)
 */
const getDefaultVerificationCriteria = () => {
  return {
    audioStatus: '1', // Survey conversation can be heard
    genderMatching: '1', // Matching
    upcomingElectionsMatching: '1', // Matching
    previousElectionsMatching: '1', // Matching
    previousLoksabhaElectionsMatching: '1', // Matching
    nameMatching: '1', // Matching
    ageMatching: '1', // Matching
    phoneNumberAsked: '1' // Yes
  };
};

/**
 * Main function
 */
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find example approval to replicate the pattern
    const exampleVerificationData = await findExampleApproval();
    
    // Use example criteria if available, otherwise use defaults
    let verificationCriteria;
    if (exampleVerificationData && exampleVerificationData.criteria) {
      verificationCriteria = exampleVerificationData.criteria;
      console.log('📋 Using verification criteria from example approval\n');
    } else {
      verificationCriteria = getDefaultVerificationCriteria();
      console.log('📋 Using default verification criteria\n');
    }

    // Find all pending CAPI responses before Jan 31, 2026
    console.log('🔍 Finding pending CAPI responses before January 31st, 2026...');
    console.log(`   Cutoff date: ${JAN31_2026.toISOString()}\n`);

    const targetResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      startTime: { $lt: JAN31_2026 }
    })
    .populate('survey', 'surveyName')
    .populate('interviewer', 'firstName lastName memberId')
    .select('_id responseId sessionId status startTime endTime interviewMode survey interviewer verificationData reviewAssignment')
    .lean();

    console.log(`📊 Found ${targetResponses.length} CAPI responses to approve\n`);

    if (targetResponses.length === 0) {
      console.log('✅ No pending CAPI responses to approve. Exiting.\n');
      await mongoose.disconnect();
      return;
    }

    // Store original data for report (for rollback)
    const originalData = targetResponses.map(r => ({
      _id: r._id.toString(),
      responseId: r.responseId || r._id.toString(),
      surveyId: r.survey?._id?.toString() || 'N/A',
      surveyName: r.survey?.surveyName || 'N/A',
      interviewerId: r.interviewer?._id?.toString() || 'N/A',
      interviewerName: `${r.interviewer?.firstName || ''} ${r.interviewer?.lastName || ''}`.trim(),
      interviewerMemberId: r.interviewer?.memberId || 'N/A',
      interviewMode: r.interviewMode || 'N/A',
      startTime: r.startTime ? new Date(r.startTime).toISOString() : 'N/A',
      endTime: r.endTime ? new Date(r.endTime).toISOString() : 'N/A',
      previousStatus: r.status,
      previousVerificationData: r.verificationData || null,
      previousReviewAssignment: r.reviewAssignment || null,
      sessionId: r.sessionId || 'N/A'
    }));

    // Show summary
    console.log('📋 Summary of responses to be approved:');
    console.log(`   Total: ${targetResponses.length} responses`);
    
    const surveyCounts = {};
    targetResponses.forEach(r => {
      const surveyName = r.survey?.surveyName || 'Unknown';
      surveyCounts[surveyName] = (surveyCounts[surveyName] || 0) + 1;
    });
    
    Object.entries(surveyCounts).forEach(([name, count]) => {
      console.log(`   - ${name}: ${count} responses`);
    });

    // Approve each response
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const approvedData = [];
    const approvalTimestamp = new Date();

    console.log('\n' + '='.repeat(70));
    console.log('APPROVING RESPONSES');
    console.log('='.repeat(70));
    console.log(`Approver ID: ${APPROVER_ID}`);
    console.log(`Total responses: ${targetResponses.length}\n`);

    for (let i = 0; i < targetResponses.length; i++) {
      const response = targetResponses[i];
      try {
        const updateData = {
          $set: {
            status: 'Approved',
            verificationData: {
              reviewer: new mongoose.Types.ObjectId(APPROVER_ID),
              reviewedAt: approvalTimestamp,
              criteria: verificationCriteria,
              feedback: '',
              // Copy criteria fields to top level for backward compatibility
              audioStatus: verificationCriteria.audioStatus,
              genderMatching: verificationCriteria.genderMatching,
              upcomingElectionsMatching: verificationCriteria.upcomingElectionsMatching,
              previousElectionsMatching: verificationCriteria.previousElectionsMatching,
              previousLoksabhaElectionsMatching: verificationCriteria.previousLoksabhaElectionsMatching,
              nameMatching: verificationCriteria.nameMatching,
              ageMatching: verificationCriteria.ageMatching,
              phoneNumberAsked: verificationCriteria.phoneNumberAsked
            },
            updatedAt: approvalTimestamp
          },
          $unset: { reviewAssignment: '' } // Clear assignment
        };

        const result = await SurveyResponse.updateOne(
          { _id: response._id },
          updateData
        );

        if (result.modifiedCount === 1) {
          successCount++;
          approvedData.push({
            ...originalData[i],
            newStatus: 'Approved',
            approvedAt: approvalTimestamp.toISOString(),
            approverId: APPROVER_ID,
            verificationCriteria: verificationCriteria
          });
          
          if ((i + 1) % 100 === 0) {
            console.log(`   ✅ Approved ${i + 1}/${targetResponses.length} responses...`);
          }
        } else {
          errorCount++;
          errors.push({
            responseId: response.responseId || response._id.toString(),
            _id: response._id.toString(),
            error: 'No document modified (may have been updated by another process)'
          });
        }
      } catch (error) {
        errorCount++;
        errors.push({
          responseId: response.responseId || response._id.toString(),
          _id: response._id.toString(),
          error: error.message
        });
        if (errorCount <= 10) {
          console.error(`   ❌ Error approving response ${response.responseId || response._id}:`, error.message);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('APPROVAL SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Successfully approved: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`📋 Total processed: ${targetResponses.length}`);
    console.log('='.repeat(70));

    // Generate comprehensive report for rollback
    const reportPath = path.join(__dirname, '../../reports/approval_report_capi_before_jan31_2026.json');
    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        scriptName: 'approve_pending_capi_before_jan31.js',
        approverId: APPROVER_ID,
        cutoffDate: JAN31_2026.toISOString(),
        interviewMode: 'capi'
      },
      summary: {
        totalFound: targetResponses.length,
        successfullyApproved: successCount,
        failed: errorCount
      },
      verificationCriteria: verificationCriteria,
      approvedResponses: approvedData.map(item => ({
        _id: item._id,
        responseId: item.responseId,
        surveyId: item.surveyId,
        surveyName: item.surveyName,
        interviewerId: item.interviewerId,
        interviewerName: item.interviewerName,
        interviewerMemberId: item.interviewerMemberId,
        interviewMode: item.interviewMode,
        startTime: item.startTime,
        endTime: item.endTime,
        sessionId: item.sessionId,
        previousStatus: item.previousStatus,
        newStatus: item.newStatus,
        approvedAt: item.approvedAt,
        approverId: item.approverId,
        previousVerificationData: item.previousVerificationData,
        previousReviewAssignment: item.previousReviewAssignment,
        verificationCriteria: item.verificationCriteria
      })),
      errors: errors.length > 0 ? errors : null,
      rollbackInstructions: {
        description: 'To rollback these approvals, set status back to "Pending_Approval" and restore previous verificationData and reviewAssignment',
        query: {
          responseIds: approvedData.map(r => r.responseId),
          _ids: approvedData.map(r => r._id)
        },
        restoreData: approvedData.map(r => ({
          _id: r._id,
          responseId: r.responseId,
          status: r.previousStatus,
          verificationData: r.previousVerificationData,
          reviewAssignment: r.previousReviewAssignment
        }))
      }
    };

    // Save JSON report
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed JSON report saved to: ${reportPath}`);

    // Also create a CSV report
    const csvPath = path.join(__dirname, '../../reports/approval_report_capi_before_jan31_2026.csv');
    let csvContent = '_id,Response ID,Survey Name,Interviewer Name,Interviewer Member ID,Interview Mode,Start Time,End Time,Previous Status,New Status,Approved At,Approver ID,Session ID\n';
    
    approvedData.forEach(item => {
      csvContent += `"${item._id}","${item.responseId}","${item.surveyName}","${item.interviewerName}","${item.interviewerMemberId}","${item.interviewMode}","${item.startTime}","${item.endTime}","${item.previousStatus}","${item.newStatus}","${item.approvedAt}","${item.approverId}","${item.sessionId}"\n`;
    });

    fs.writeFileSync(csvPath, csvContent);
    console.log(`📄 CSV report saved to: ${csvPath}`);

    // Create rollback script
    const rollbackScriptPath = path.join(__dirname, '../../reports/rollback_approval_capi_before_jan31_2026.js');
    const rollbackScript = `#!/usr/bin/env node

/**
 * Rollback Script for CAPI Approvals Before Jan 31, 2026
 * 
 * This script restores the previous status and verification data for responses
 * that were approved by approve_pending_capi_before_jan31.js
 * 
 * Generated: ${new Date().toISOString()}
 * 
 * Usage: node rollback_approval_capi_before_jan31_2026.js
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const SurveyResponse = require('../opine/backend/models/SurveyResponse');
require('dotenv').config({ path: path.join(__dirname, '../opine/backend/.env') });

const REPORT_PATH = path.join(__dirname, 'approval_report_capi_before_jan31_2026.json');

async function rollback() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Load report
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    console.log(\`📋 Loaded report: \${report.metadata.timestamp}\`);
    console.log(\`📊 Total responses to rollback: \${report.summary.successfullyApproved}\n\`);
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    console.log('🔄 Starting rollback process...\n');
    
    for (let i = 0; i < report.rollbackInstructions.restoreData.length; i++) {
      const item = report.rollbackInstructions.restoreData[i];
      
      try {
        const updateData = {
          $set: {
            status: item.status,
            updatedAt: new Date()
          }
        };
        
        // Restore verificationData if it existed
        if (item.verificationData) {
          updateData.$set.verificationData = item.verificationData;
        } else {
          updateData.$unset = { verificationData: '' };
        }
        
        // Restore reviewAssignment if it existed
        if (item.reviewAssignment) {
          updateData.$set.reviewAssignment = item.reviewAssignment;
        } else {
          if (!updateData.$unset) updateData.$unset = {};
          updateData.$unset.reviewAssignment = '';
        }
        
        const result = await SurveyResponse.updateOne(
          { _id: new mongoose.Types.ObjectId(item._id) },
          updateData
        );
        
        if (result.modifiedCount === 1) {
          successCount++;
          if ((i + 1) % 100 === 0) {
            console.log(\`   ✅ Rolled back \${i + 1}/\${report.rollbackInstructions.restoreData.length} responses...\`);
          }
        } else {
          errorCount++;
          errors.push({ _id: item._id, error: 'No document modified' });
        }
      } catch (error) {
        errorCount++;
        errors.push({ _id: item._id, error: error.message });
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('ROLLBACK SUMMARY');
    console.log('='.repeat(70));
    console.log(\`✅ Successfully rolled back: \${successCount}\`);
    console.log(\`❌ Failed: \${errorCount}\`);
    console.log('='.repeat(70));
    
    if (errors.length > 0 && errors.length <= 10) {
      console.log('\n⚠️  Errors:');
      errors.forEach(err => console.log(\`   - \${err._id}: \${err.error}\`));
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Rollback completed');
    
  } catch (error) {
    console.error('❌ Rollback error:', error);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

rollback();
`;

    fs.writeFileSync(rollbackScriptPath, rollbackScript);
    fs.chmodSync(rollbackScriptPath, '755');
    console.log(`📄 Rollback script saved to: ${rollbackScriptPath}`);

    // Verify the results
    console.log('\n🔍 Verifying results...');
    const remainingPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      startTime: { $lt: JAN31_2026 }
    });

    const approvedCount = await SurveyResponse.countDocuments({
      status: 'Approved',
      interviewMode: 'capi',
      'verificationData.reviewer': new mongoose.Types.ObjectId(APPROVER_ID),
      startTime: { $lt: JAN31_2026 }
    });

    console.log(`   Remaining pending CAPI before Jan 31, 2026: ${remainingPending}`);
    console.log(`   Approved CAPI by ${APPROVER_ID} before Jan 31, 2026: ${approvedCount}\n`);

    await mongoose.connection.close();
    console.log('✅ Done');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();











































