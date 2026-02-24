#!/usr/bin/env node

/**
 * Check Interviewer AC Assignment
 * 
 * This script checks if an interviewer has been correctly assigned ACs in the survey
 * 
 * Usage:
 *   node check_interviewer_assignment.js <memberId> [survey_id]
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

/**
 * Connect to MongoDB
 */
async function connectDB() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI not found in environment variables');
  }
  
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');
}

/**
 * Check interviewer assignment
 */
async function checkInterviewerAssignment(surveyId, memberId) {
  console.log(`\n📊 Checking interviewer assignment...`);
  
  // Find user by memberId
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    throw new Error(`Interviewer with member ID ${memberId} not found`);
  }
  
  console.log(`✅ Found interviewer: ${user.firstName} ${user.lastName} (${user.memberId})`);
  console.log(`   User ID: ${user._id}`);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  console.log(`   Survey ID: ${surveyId}`);
  console.log(`   assignACs flag: ${survey.assignACs}`);
  
  // Check catiInterviewers
  if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
    console.log(`\n❌ No CATI interviewers assigned to this survey`);
    return;
  }
  
  console.log(`\n📋 Total CATI interviewers in survey: ${survey.catiInterviewers.length}`);
  
  // Find assignment for this interviewer
  const assignment = survey.catiInterviewers.find(
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    console.log(`\n❌ Interviewer ${memberId} is NOT assigned to this survey for CATI`);
    console.log(`\n📋 Available interviewer IDs in survey:`);
    survey.catiInterviewers.forEach((a, idx) => {
      const interviewerId = a.interviewer ? a.interviewer.toString() : 'MISSING';
      console.log(`   ${idx + 1}. Interviewer ID: ${interviewerId}, Status: ${a.status || 'N/A'}`);
    });
    return;
  }
  
  console.log(`\n✅ Interviewer ${memberId} IS assigned to this survey`);
  console.log(`\n📋 Assignment Details:`);
  console.log(`   - Status: ${assignment.status || 'N/A'}`);
  console.log(`   - Assigned By: ${assignment.assignedBy || 'N/A'}`);
  console.log(`   - Assigned At: ${assignment.assignedAt || 'N/A'}`);
  console.log(`   - Max Interviews: ${assignment.maxInterviews || 0}`);
  console.log(`   - Completed Interviews: ${assignment.completedInterviews || 0}`);
  
  // Check assignedACs
  if (!assignment.assignedACs || assignment.assignedACs.length === 0) {
    console.log(`\n⚠️  WARNING: No ACs assigned to this interviewer!`);
    console.log(`   This means the interviewer can get contacts from ANY AC.`);
    console.log(`   assignedACs array: ${JSON.stringify(assignment.assignedACs)}`);
  } else {
    console.log(`\n✅ Assigned ACs (${assignment.assignedACs.length}):`);
    assignment.assignedACs.forEach((ac, idx) => {
      console.log(`   ${idx + 1}. ${ac}`);
    });
  }
  
  // Check if Taldangra is in the list
  const hasTaldangra = assignment.assignedACs && assignment.assignedACs.some(
    ac => ac.toLowerCase().trim() === 'taldangra'
  );
  
  if (hasTaldangra) {
    console.log(`\n✅ Taldangra is in the assigned ACs list`);
  } else {
    console.log(`\n❌ Taldangra is NOT in the assigned ACs list`);
    if (assignment.assignedACs && assignment.assignedACs.length > 0) {
      console.log(`   Current assigned ACs: ${assignment.assignedACs.join(', ')}`);
    }
  }
  
  // Check respondent queue for this interviewer's assigned ACs
  if (assignment.assignedACs && assignment.assignedACs.length > 0) {
    console.log(`\n📊 Checking respondent queue for assigned ACs...`);
    
    const queueStats = await CatiRespondentQueue.aggregate([
      {
        $match: {
          survey: new mongoose.Types.ObjectId(surveyId),
          'respondentContact.ac': { $in: assignment.assignedACs }
        }
      },
      {
        $group: {
          _id: '$respondentContact.ac',
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          assigned: { $sum: { $cond: [{ $eq: ['$status', 'assigned'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          total: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    if (queueStats.length > 0) {
      console.log(`\n✅ Queue statistics for assigned ACs:`);
      queueStats.forEach(stat => {
        console.log(`   AC: ${stat._id || 'NO AC'}`);
        console.log(`      - Pending: ${stat.pending}`);
        console.log(`      - Assigned: ${stat.assigned}`);
        console.log(`      - Completed: ${stat.completed}`);
        console.log(`      - Total: ${stat.total}`);
      });
    } else {
      console.log(`\n⚠️  No respondents found in queue for assigned ACs`);
    }
    
    // Check for other ACs in queue (not in assigned list)
    const otherACs = await CatiRespondentQueue.aggregate([
      {
        $match: {
          survey: new mongoose.Types.ObjectId(surveyId),
          status: 'pending',
          'respondentContact.ac': { $nin: assignment.assignedACs }
        }
      },
      {
        $group: {
          _id: '$respondentContact.ac',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    if (otherACs.length > 0) {
      console.log(`\n⚠️  WARNING: There are pending respondents from OTHER ACs (not in assigned list):`);
      otherACs.forEach(ac => {
        console.log(`   - ${ac._id || 'NO AC'}: ${ac.count} pending`);
      });
      console.log(`\n   This could cause issues if the filtering logic is not working correctly.`);
    }
  } else {
    console.log(`\n⚠️  Cannot check queue - no ACs assigned to interviewer`);
  }
  
  return {
    interviewer: {
      memberId: user.memberId,
      name: `${user.firstName} ${user.lastName}`,
      userId: user._id.toString()
    },
    assignment: {
      status: assignment.status,
      assignedACs: assignment.assignedACs || [],
      hasTaldangra: hasTaldangra
    },
    survey: {
      id: surveyId,
      name: survey.surveyName,
      assignACs: survey.assignACs
    }
  };
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('❌ Error: Member ID is required');
      console.error('\nUsage: node check_interviewer_assignment.js <memberId> [survey_id]');
      console.error('\nExample:');
      console.error('  node check_interviewer_assignment.js 10007');
      console.error('  node check_interviewer_assignment.js 10007 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const memberId = args[0];
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('CHECK INTERVIEWER AC ASSIGNMENT');
    console.log('='.repeat(70));
    console.log(`Member ID: ${memberId}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Connect to database
    await connectDB();
    
    // Check assignment
    const result = await checkInterviewerAssignment(surveyId, memberId);
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    
    if (result) {
      console.log(`Interviewer: ${result.interviewer.name} (${result.interviewer.memberId})`);
      console.log(`Survey: ${result.survey.name}`);
      console.log(`Assigned ACs: ${result.assignment.assignedACs.length > 0 ? result.assignment.assignedACs.join(', ') : 'NONE'}`);
      console.log(`Has Taldangra: ${result.assignment.hasTaldangra ? 'YES ✅' : 'NO ❌'}`);
      
      if (!result.assignment.hasTaldangra && result.assignment.assignedACs.length > 0) {
        console.log(`\n⚠️  ISSUE: Taldangra is not in the assigned ACs list!`);
        console.log(`   The interviewer will NOT get Taldangra contacts.`);
      } else if (result.assignment.assignedACs.length === 0) {
        console.log(`\n⚠️  ISSUE: No ACs assigned - interviewer can get ANY AC contacts!`);
      }
    }
    
    console.log('='.repeat(70));
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, checkInterviewerAssignment };

















































