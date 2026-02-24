#!/usr/bin/env node

/**
 * Convert CATI Interviewer to CAPI Interviewer Script
 * 
 * This script converts a CATI interviewer back to CAPI interviewer by:
 * 1. Changing memberId from "1591" to "CAPI1591" (adding CAPI prefix)
 * 2. Setting interviewModes to 'CAPI (Face To Face)'
 * 3. Removing from survey.catiInterviewers array
 * 4. Adding to survey.capiInterviewers array
 * 
 * Usage:
 *   node convert_cati_to_capi.js <currentMemberId> [survey_id]
 * 
 * Example:
 *   node convert_cati_to_capi.js 1591
 *   node convert_cati_to_capi.js 1591 68fd1915d41841da463f0d46
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
 * Add CAPI prefix to member ID (e.g., "1591" -> "CAPI1591")
 */
function addCAPIPrefix(memberId) {
  // If already has CAPI prefix (case-insensitive), return as-is
  if (/^CAPI/i.test(memberId)) {
    return memberId.toUpperCase().replace(/^CAPI/, 'CAPI'); // Normalize to CAPI
  }
  
  // Add CAPI prefix
  return `CAPI${memberId}`;
}

/**
 * Convert CATI interviewer to CAPI interviewer
 */
async function convertCATItoCAPI(currentMemberId, surveyId) {
  console.log(`\n🔄 Converting CATI interviewer to CAPI interviewer...`);
  console.log(`   Current Member ID: ${currentMemberId}`);
  
  // Add CAPI prefix
  const newMemberId = addCAPIPrefix(currentMemberId);
  console.log(`   New Member ID: ${newMemberId}`);
  
  // Find user by current member ID
  const user = await User.findOne({ 
    memberId: currentMemberId
  });
  
  if (!user) {
    throw new Error(`User with memberId "${currentMemberId}" not found`);
  }
  
  console.log(`✅ Found user: ${user.firstName} ${user.lastName} (${user.memberId})`);
  console.log(`   Current userType: ${user.userType}`);
  console.log(`   Current interviewModes: ${user.interviewModes || 'Not set'}`);
  
  // Check if new member ID already exists (different user)
  const existingUserWithNewId = await User.findOne({ 
    memberId: newMemberId,
    _id: { $ne: user._id }
  });
  
  if (existingUserWithNewId) {
    throw new Error(`Member ID "${newMemberId}" is already taken by another user: ${existingUserWithNewId.firstName} ${existingUserWithNewId.lastName}`);
  }
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  
  // Check CATI assignment
  let catiAssignmentIndex = -1;
  if (survey.catiInterviewers && Array.isArray(survey.catiInterviewers)) {
    catiAssignmentIndex = survey.catiInterviewers.findIndex(
      assignment => assignment.interviewer && assignment.interviewer.toString() === user._id.toString()
    );
  }
  
  if (catiAssignmentIndex === -1) {
    console.log(`⚠️  User is not assigned as CATI interviewer in this survey`);
  } else {
    console.log(`✅ Found CATI assignment at index ${catiAssignmentIndex}`);
  }
  
  // Check CAPI assignment
  let capiAssignmentIndex = -1;
  if (survey.capiInterviewers && Array.isArray(survey.capiInterviewers)) {
    capiAssignmentIndex = survey.capiInterviewers.findIndex(
      assignment => assignment.interviewer && assignment.interviewer.toString() === user._id.toString()
    );
  }
  
  if (capiAssignmentIndex !== -1) {
    console.log(`⚠️  User is already assigned as CAPI interviewer in this survey`);
  }
  
  // Update user
  console.log(`\n📝 Updating user...`);
  
  const updateData = {
    memberId: newMemberId,
    userType: 'interviewer',
    interviewModes: 'CAPI (Face To Face)'
  };
  
  await User.updateOne(
    { _id: user._id },
    { $set: updateData }
  );
  
  console.log(`✅ Updated user:`);
  console.log(`   - memberId: ${currentMemberId} → ${newMemberId}`);
  console.log(`   - userType: ${user.userType} → interviewer`);
  console.log(`   - interviewModes: ${user.interviewModes || 'Not set'} → CAPI (Face To Face)`);
  
  // Update survey assignments
  console.log(`\n📋 Updating survey assignments...`);
  
  // Remove from CATI interviewers
  if (catiAssignmentIndex !== -1) {
    survey.catiInterviewers.splice(catiAssignmentIndex, 1);
    survey.markModified('catiInterviewers');
    console.log(`✅ Removed from CATI interviewers`);
  }
  
  // Add to CAPI interviewers (if not already there)
  if (capiAssignmentIndex === -1) {
    if (!survey.capiInterviewers) {
      survey.capiInterviewers = [];
    }
    
    survey.capiInterviewers.push({
      interviewer: user._id,
      assignedBy: user._id, // Use user's own ID as assignedBy
      assignedAt: new Date(),
      status: 'assigned',
      assignedACs: [],
      selectedState: null,
      selectedCountry: null,
      maxInterviews: 0,
      completedInterviews: 0
    });
    
    survey.markModified('capiInterviewers');
    console.log(`✅ Added to CAPI interviewers`);
  }
  
  await survey.save();
  console.log(`✅ Survey updated successfully`);
  
  return {
    success: true,
    currentMemberId,
    newMemberId,
    userId: user._id.toString(),
    userName: `${user.firstName} ${user.lastName}`,
    removedFromCATI: catiAssignmentIndex !== -1,
    addedToCAPI: capiAssignmentIndex === -1
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
      console.error('❌ Error: Current member ID is required');
      console.error('\nUsage: node convert_cati_to_capi.js <currentMemberId> [survey_id]');
      console.error('\nExample:');
      console.error('  node convert_cati_to_capi.js 1591');
      console.error('  node convert_cati_to_capi.js 1591 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const currentMemberId = args[0];
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('CONVERT CATI INTERVIEWER TO CAPI INTERVIEWER');
    console.log('='.repeat(70));
    console.log(`Current Member ID: ${currentMemberId}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Connect to database
    await connectDB();
    
    // Convert interviewer
    const result = await convertCATItoCAPI(currentMemberId, surveyId);
    
    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('CONVERSION RESULT');
    console.log('='.repeat(70));
    console.log(`✅ Successfully converted interviewer`);
    console.log(`   - User: ${result.userName}`);
    console.log(`   - Current Member ID: ${result.currentMemberId}`);
    console.log(`   - New Member ID: ${result.newMemberId}`);
    console.log(`   - Removed from CATI: ${result.removedFromCATI ? 'Yes' : 'No (was not assigned)'}`);
    console.log(`   - Added to CAPI: ${result.addedToCAPI ? 'Yes' : 'No (already assigned)'}`);
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

module.exports = { main, convertCATItoCAPI, addCAPIPrefix };














