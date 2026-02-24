#!/usr/bin/env node

/**
 * Diagnose "No Respondents" Issue
 * 
 * This script checks why interviewers are getting "No Respondents" error
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function diagnoseInterviewer(memberId, surveyId) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`DIAGNOSING INTERVIEWER: ${memberId}`);
  console.log('='.repeat(70));
  
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    console.log(`❌ Interviewer with member ID ${memberId} not found`);
    return;
  }
  
  console.log(`✅ Interviewer: ${user.firstName} ${user.lastName} (${user.memberId})`);
  console.log(`   User ID: ${user._id}`);
  
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    console.log(`❌ Survey ${surveyId} not found`);
    return;
  }
  
  const assignment = survey.catiInterviewers?.find(
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    console.log(`❌ Interviewer is NOT assigned to this survey`);
    return;
  }
  
  console.log(`\n📋 Assignment Details:`);
  console.log(`   Status: ${assignment.status}`);
  console.log(`   Assigned ACs: ${assignment.assignedACs?.length || 0}`);
  if (assignment.assignedACs && assignment.assignedACs.length > 0) {
    assignment.assignedACs.forEach((ac, idx) => {
      console.log(`     ${idx + 1}. ${ac}`);
    });
  } else {
    console.log(`   ⚠️  NO ACs ASSIGNED - This is the problem!`);
    console.log(`      Without assigned ACs, the system may not filter correctly.`);
  }
  
  // Check queue for assigned ACs
  if (assignment.assignedACs && assignment.assignedACs.length > 0) {
    console.log(`\n📊 Queue Analysis for Assigned ACs:`);
    
    for (const acName of assignment.assignedACs) {
      const stats = await CatiRespondentQueue.aggregate([
        {
          $match: {
            survey: new mongoose.Types.ObjectId(surveyId),
            'respondentContact.ac': acName
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);
      
      console.log(`\n   AC: ${acName}`);
      const statusMap = {};
      stats.forEach(s => {
        statusMap[s._id] = s.count;
      });
      
      console.log(`      Pending: ${statusMap.pending || 0}`);
      console.log(`      Assigned: ${statusMap.assigned || 0}`);
      console.log(`      Completed: ${statusMap.completed || 0}`);
      console.log(`      Total: ${Object.values(statusMap).reduce((a, b) => a + b, 0)}`);
      
      // Check if there are any pending that are NOT assigned to this interviewer
      const pendingNotAssigned = await CatiRespondentQueue.countDocuments({
        survey: new mongoose.Types.ObjectId(surveyId),
        'respondentContact.ac': acName,
        status: 'pending',
        assignedTo: { $ne: user._id }
      });
      
      const pendingAssignedToThis = await CatiRespondentQueue.countDocuments({
        survey: new mongoose.Types.ObjectId(surveyId),
        'respondentContact.ac': acName,
        status: 'pending',
        assignedTo: user._id
      });
      
      console.log(`      Pending (not assigned to this interviewer): ${pendingNotAssigned}`);
      console.log(`      Pending (assigned to this interviewer): ${pendingAssignedToThis}`);
      
      // Check for any pending at all
      const anyPending = await CatiRespondentQueue.countDocuments({
        survey: new mongoose.Types.ObjectId(surveyId),
        'respondentContact.ac': acName,
        status: 'pending'
      });
      
      if (anyPending === 0) {
        console.log(`      ⚠️  NO PENDING CONTACTS - All contacts are already assigned or completed!`);
      }
    }
  } else {
    // Check all pending contacts (no AC filter)
    const allPending = await CatiRespondentQueue.countDocuments({
      survey: new mongoose.Types.ObjectId(surveyId),
      status: 'pending'
    });
    
    console.log(`\n📊 Queue Analysis (No AC Filter):`);
    console.log(`   Total pending in queue: ${allPending}`);
    
    if (allPending === 0) {
      console.log(`   ⚠️  NO PENDING CONTACTS IN ENTIRE QUEUE!`);
    }
  }
  
  // Check survey assignACs flag
  console.log(`\n📋 Survey Settings:`);
  console.log(`   assignACs flag: ${survey.assignACs}`);
  console.log(`   acAssignmentState: ${survey.acAssignmentState || 'N/A'}`);
  
  if (survey.assignACs && (!assignment.assignedACs || assignment.assignedACs.length === 0)) {
    console.log(`\n❌ CRITICAL ISSUE:`);
    console.log(`   Survey has assignACs=true, but interviewer has NO assigned ACs!`);
    console.log(`   The system will filter by assigned ACs, but since there are none,`);
    console.log(`   it will find NO matching contacts.`);
  }
  
  // Check if there are any contacts assigned to this interviewer that are stuck
  const stuckAssigned = await CatiRespondentQueue.countDocuments({
    survey: new mongoose.Types.ObjectId(surveyId),
    assignedTo: user._id,
    status: 'assigned'
  });
  
  if (stuckAssigned > 0) {
    console.log(`\n⚠️  WARNING: ${stuckAssigned} contacts are assigned to this interviewer but not completed.`);
    console.log(`   These might be stuck in 'assigned' status.`);
  }
}

async function main() {
  try {
    const memberIds = process.argv.slice(2);
    
    if (memberIds.length === 0) {
      console.error('Usage: node diagnose_no_respondents.js <memberId1> [memberId2] ...');
      console.error('Example: node diagnose_no_respondents.js 10005 10003');
      process.exit(1);
    }
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    for (const memberId of memberIds) {
      await diagnoseInterviewer(memberId, DEFAULT_SURVEY_ID);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();

















































