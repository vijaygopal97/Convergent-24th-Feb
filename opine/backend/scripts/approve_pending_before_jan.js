#!/usr/bin/env node

/**
 * Approve Pending Approval Responses Before January 1st, 2026
 * 
 * This script:
 * 1. Finds all responses in "Pending_Approval" status with startTime before Jan 1, 2026
 * 2. Approves them using the same approval method as other approved responses
 * 3. Creates a detailed report of the changes
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
const JAN1_2026 = new Date('2026-01-01T00:00:00.000Z');

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

    // Find all pending responses before Jan 1, 2026
    console.log('🔍 Finding pending responses before January 1st, 2026...');
    console.log(`   Cutoff date: ${JAN1_2026.toISOString()}\n`);

    const targetResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      startTime: { $lt: JAN1_2026 }
    })
    .populate('survey', 'surveyName')
    .populate('interviewer', 'firstName lastName memberId')
    .select('_id responseId sessionId status startTime endTime interviewMode survey interviewer')
    .lean();

    console.log(`📊 Found ${targetResponses.length} responses to approve:\n`);

    if (targetResponses.length === 0) {
      console.log('✅ No pending responses to approve. Exiting.\n');
      await mongoose.disconnect();
      return;
    }

    // Show details of responses to be approved
    console.log('📋 Responses to be approved:');
    targetResponses.forEach((resp, idx) => {
      console.log(`\n${idx + 1}. Response ID: ${resp.responseId || resp._id}`);
      console.log(`   Survey: ${resp.survey?.surveyName || 'N/A'}`);
      console.log(`   Interviewer: ${resp.interviewer?.firstName || ''} ${resp.interviewer?.lastName || ''} (${resp.interviewer?.memberId || 'N/A'})`);
      console.log(`   Mode: ${resp.interviewMode || 'N/A'}`);
      console.log(`   Start Time: ${resp.startTime ? new Date(resp.startTime).toISOString() : 'N/A'}`);
      console.log(`   End Time: ${resp.endTime ? new Date(resp.endTime).toISOString() : 'N/A'}`);
      console.log(`   Status: ${resp.status}`);
    });

    // Store original data for report
    const originalData = targetResponses.map(r => ({
      responseId: r.responseId || r._id.toString(),
      surveyName: r.survey?.surveyName || 'N/A',
      interviewerName: `${r.interviewer?.firstName || ''} ${r.interviewer?.lastName || ''}`.trim(),
      interviewerMemberId: r.interviewer?.memberId || 'N/A',
      interviewMode: r.interviewMode || 'N/A',
      startTime: r.startTime ? new Date(r.startTime).toISOString() : 'N/A',
      endTime: r.endTime ? new Date(r.endTime).toISOString() : 'N/A',
      previousStatus: r.status
    }));

    // Approve each response
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    const approvedData = [];

    console.log('\n' + '='.repeat(70));
    console.log('APPROVING RESPONSES');
    console.log('='.repeat(70));
    console.log(`Approver ID: ${APPROVER_ID}\n`);

    for (let i = 0; i < targetResponses.length; i++) {
      const response = targetResponses[i];
      try {
        const updateData = {
          $set: {
            status: 'Approved',
            verificationData: {
              reviewer: new mongoose.Types.ObjectId(APPROVER_ID),
              reviewedAt: new Date(),
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
            updatedAt: new Date()
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
            approvedAt: new Date().toISOString(),
            approverId: APPROVER_ID
          });
          console.log(`✅ Approved ${i + 1}/${targetResponses.length}: ${response.responseId || response._id}`);
        } else {
          errorCount++;
          errors.push({
            responseId: response.responseId || response._id,
            error: 'No document modified (may have been updated by another process)'
          });
          console.log(`❌ Failed ${i + 1}/${targetResponses.length}: ${response.responseId || response._id}`);
        }
      } catch (error) {
        errorCount++;
        errors.push({
          responseId: response.responseId || response._id,
          error: error.message
        });
        console.error(`❌ Error approving response ${response.responseId || response._id}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('APPROVAL SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Successfully approved: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`📋 Total processed: ${targetResponses.length}`);
    console.log('='.repeat(70));

    // Generate report
    const reportPath = path.join(__dirname, '../../reports/approval_report_before_jan_2026.json');
    const report = {
      timestamp: new Date().toISOString(),
      approverId: APPROVER_ID,
      cutoffDate: JAN1_2026.toISOString(),
      summary: {
        totalFound: targetResponses.length,
        successfullyApproved: successCount,
        failed: errorCount
      },
      verificationCriteria: verificationCriteria,
      approvedResponses: approvedData,
      errors: errors.length > 0 ? errors : null
    };

    // Save report
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);

    // Also create a CSV report
    const csvPath = path.join(__dirname, '../../reports/approval_report_before_jan_2026.csv');
    let csvContent = 'Response ID,Survey Name,Interviewer Name,Interviewer Member ID,Interview Mode,Start Time,End Time,Previous Status,New Status,Approved At,Approver ID\n';
    
    approvedData.forEach(item => {
      csvContent += `"${item.responseId}","${item.surveyName}","${item.interviewerName}","${item.interviewerMemberId}","${item.interviewMode}","${item.startTime}","${item.endTime}","${item.previousStatus}","${item.newStatus}","${item.approvedAt}","${item.approverId}"\n`;
    });

    fs.writeFileSync(csvPath, csvContent);
    console.log(`📄 CSV report saved to: ${csvPath}`);

    // Verify the results
    console.log('\n🔍 Verifying results...');
    const remainingPending = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      startTime: { $lt: JAN1_2026 }
    });

    const approvedCount = await SurveyResponse.countDocuments({
      status: 'Approved',
      'verificationData.reviewer': new mongoose.Types.ObjectId(APPROVER_ID),
      startTime: { $lt: JAN1_2026 }
    });

    console.log(`   Remaining pending before Jan 1, 2026: ${remainingPending}`);
    console.log(`   Approved by ${APPROVER_ID} before Jan 1, 2026: ${approvedCount}\n`);

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











































