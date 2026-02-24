#!/usr/bin/env node

/**
 * Remove AC from Interviewer Assignment
 * 
 * This script removes a specific AC from an interviewer's assigned ACs list
 * 
 * Usage:
 *   node remove_ac_from_interviewer.js <memberId> <acName> [survey_id]
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');

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
 * Remove AC from interviewer assignment
 */
async function removeACFromInterviewer(surveyId, memberId, acNameToRemove) {
  console.log(`\n📊 Removing AC from interviewer assignment...`);
  
  // Find user by memberId
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    throw new Error(`Interviewer with member ID ${memberId} not found`);
  }
  
  console.log(`✅ Found interviewer: ${user.firstName} ${user.lastName} (${user.memberId})`);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  // Find interviewer assignment in survey
  const assignment = survey.catiInterviewers.find(
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    throw new Error(`Interviewer ${memberId} is not assigned to this survey for CATI`);
  }
  
  console.log(`✅ Found assignment for interviewer`);
  console.log(`   Current assigned ACs: ${assignment.assignedACs ? assignment.assignedACs.join(', ') : 'NONE'}`);
  
  // Check if AC is in the list
  if (!assignment.assignedACs || assignment.assignedACs.length === 0) {
    console.log(`⚠️  No ACs assigned to this interviewer`);
    return {
      success: true,
      removed: false,
      memberId,
      acName: acNameToRemove,
      remainingACs: []
    };
  }
  
  // Check if the AC exists (case-insensitive)
  const acIndex = assignment.assignedACs.findIndex(
    ac => ac.toLowerCase().trim() === acNameToRemove.toLowerCase().trim()
  );
  
  if (acIndex === -1) {
    console.log(`⚠️  AC "${acNameToRemove}" is not in the assigned ACs list`);
    return {
      success: true,
      removed: false,
      memberId,
      acName: acNameToRemove,
      remainingACs: assignment.assignedACs
    };
  }
  
  // Remove the AC
  const removedAC = assignment.assignedACs[acIndex];
  assignment.assignedACs.splice(acIndex, 1);
  
  console.log(`✅ Removed AC: "${removedAC}"`);
  console.log(`   Remaining assigned ACs: ${assignment.assignedACs.length > 0 ? assignment.assignedACs.join(', ') : 'NONE'}`);
  
  // Save survey
  await survey.save();
  console.log(`✅ Survey saved successfully`);
  
  return {
    success: true,
    removed: true,
    memberId,
    acName: acNameToRemove,
    removedACName: removedAC,
    remainingACs: assignment.assignedACs,
    interviewerName: `${user.firstName} ${user.lastName}`
  };
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
      console.error('❌ Error: Member ID and AC name are required');
      console.error('\nUsage: node remove_ac_from_interviewer.js <memberId> <acName> [survey_id]');
      console.error('\nExample:');
      console.error('  node remove_ac_from_interviewer.js 10007 Haringhata');
      console.error('  node remove_ac_from_interviewer.js 10007 "Haringhata" 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const memberId = args[0];
    const acName = args[1];
    const surveyId = args[2] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('REMOVE AC FROM INTERVIEWER ASSIGNMENT');
    console.log('='.repeat(70));
    console.log(`Member ID: ${memberId}`);
    console.log(`AC Name to Remove: ${acName}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Connect to database
    await connectDB();
    
    // Remove AC
    const result = await removeACFromInterviewer(surveyId, memberId, acName);
    
    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('REMOVAL RESULT');
    console.log('='.repeat(70));
    
    if (result.removed) {
      console.log(`✅ Successfully removed AC`);
      console.log(`  - Interviewer: ${result.interviewerName} (${result.memberId})`);
      console.log(`  - Removed AC: ${result.removedACName}`);
      console.log(`  - Remaining ACs: ${result.remainingACs.length > 0 ? result.remainingACs.join(', ') : 'NONE'}`);
    } else {
      console.log(`⚠️  AC was not removed`);
      console.log(`  - Interviewer: ${result.memberId}`);
      console.log(`  - AC: ${result.acName}`);
      console.log(`  - Reason: ${result.remainingACs.length === 0 ? 'No ACs assigned' : 'AC not in assigned list'}`);
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

module.exports = { main, removeACFromInterviewer };

















































