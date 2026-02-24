#!/usr/bin/env node

/**
 * Convert CAPI Interviewer to CATI Interviewer Script
 * 
 * This script converts a CAPI interviewer to CATI interviewer by:
 * 1. Changing memberId from "CAPi8328" to "8328" (removing CAPI prefix)
 * 2. Setting interviewModes to 'CATI (Telephonic interview)'
 * 3. Removing from survey.capiInterviewers array
 * 4. Adding to survey.catiInterviewers array
 * 
 * Usage:
 *   node convert_capi_to_cati.js <oldMemberId> [survey_id]
 * 
 * Example:
 *   node convert_capi_to_cati.js CAPi8328
 *   node convert_capi_to_cati.js CAPi8328 68fd1915d41841da463f0d46
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
 * Extract numeric part from member ID (e.g., "CAPi8328" -> "8328")
 */
function extractNumericMemberId(memberId) {
  // Remove any non-numeric characters (CAPI, CAPi, etc.)
  const numericPart = memberId.replace(/^[A-Za-z]+/i, '');
  if (!numericPart || numericPart.length === 0) {
    throw new Error(`Could not extract numeric part from memberId: ${memberId}`);
  }
  return numericPart;
}

/**
 * Convert CAPI interviewer to CATI interviewer
 */
async function convertCAPItoCATI(oldMemberId, surveyId) {
  console.log(`\n🔄 Converting CAPI interviewer to CATI interviewer...`);
  console.log(`   Old Member ID: ${oldMemberId}`);
  
  // Extract numeric member ID
  const newMemberId = extractNumericMemberId(oldMemberId);
  console.log(`   New Member ID: ${newMemberId}`);
  
  // Find user by old member ID (case-insensitive)
  const user = await User.findOne({ 
    memberId: { $regex: new RegExp(`^${oldMemberId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
  });
  
  if (!user) {
    throw new Error(`User with memberId "${oldMemberId}" not found`);
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
  
  // Check CAPI assignment
  let capiAssignmentIndex = -1;
  if (survey.capiInterviewers && Array.isArray(survey.capiInterviewers)) {
    capiAssignmentIndex = survey.capiInterviewers.findIndex(
      assignment => assignment.interviewer && assignment.interviewer.toString() === user._id.toString()
    );
  }
  
  if (capiAssignmentIndex === -1) {
    console.log(`⚠️  User is not assigned as CAPI interviewer in this survey`);
  } else {
    console.log(`✅ Found CAPI assignment at index ${capiAssignmentIndex}`);
  }
  
  // Check CATI assignment
  let catiAssignmentIndex = -1;
  if (survey.catiInterviewers && Array.isArray(survey.catiInterviewers)) {
    catiAssignmentIndex = survey.catiInterviewers.findIndex(
      assignment => assignment.interviewer && assignment.interviewer.toString() === user._id.toString()
    );
  }
  
  if (catiAssignmentIndex !== -1) {
    console.log(`⚠️  User is already assigned as CATI interviewer in this survey`);
  }
  
  // Update user
  console.log(`\n📝 Updating user...`);
  
  const updateData = {
    memberId: newMemberId,
    userType: 'interviewer',
    interviewModes: 'CATI (Telephonic interview)'
  };
  
  await User.updateOne(
    { _id: user._id },
    { $set: updateData }
  );
  
  console.log(`✅ Updated user:`);
  console.log(`   - memberId: ${oldMemberId} → ${newMemberId}`);
  console.log(`   - userType: ${user.userType} → interviewer`);
  console.log(`   - interviewModes: ${user.interviewModes || 'Not set'} → CATI (Telephonic interview)`);
  
  // Update survey assignments
  console.log(`\n📋 Updating survey assignments...`);
  
  // Remove from CAPI interviewers
  if (capiAssignmentIndex !== -1) {
    survey.capiInterviewers.splice(capiAssignmentIndex, 1);
    survey.markModified('capiInterviewers');
    console.log(`✅ Removed from CAPI interviewers`);
  }
  
  // Add to CATI interviewers (if not already there)
  if (catiAssignmentIndex === -1) {
    if (!survey.catiInterviewers) {
      survey.catiInterviewers = [];
    }
    
    survey.catiInterviewers.push({
      interviewer: user._id,
      assignedBy: user._id, // Use user's own ID as assignedBy
      assignedAt: new Date(),
      status: 'assigned',
      assignedACs: [],
      maxInterviews: 0,
      completedInterviews: 0
    });
    
    survey.markModified('catiInterviewers');
    console.log(`✅ Added to CATI interviewers`);
  }
  
  await survey.save();
  console.log(`✅ Survey updated successfully`);
  
  return {
    success: true,
    oldMemberId,
    newMemberId,
    userId: user._id.toString(),
    userName: `${user.firstName} ${user.lastName}`,
    removedFromCAPI: capiAssignmentIndex !== -1,
    addedToCATI: catiAssignmentIndex === -1
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
      console.error('❌ Error: Old member ID is required');
      console.error('\nUsage: node convert_capi_to_cati.js <oldMemberId> [survey_id]');
      console.error('\nExample:');
      console.error('  node convert_capi_to_cati.js CAPi8328');
      console.error('  node convert_capi_to_cati.js CAPi8328 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const oldMemberId = args[0];
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('CONVERT CAPI INTERVIEWER TO CATI INTERVIEWER');
    console.log('='.repeat(70));
    console.log(`Old Member ID: ${oldMemberId}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Connect to database
    await connectDB();
    
    // Convert interviewer
    const result = await convertCAPItoCATI(oldMemberId, surveyId);
    
    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('CONVERSION RESULT');
    console.log('='.repeat(70));
    console.log(`✅ Successfully converted interviewer`);
    console.log(`   - User: ${result.userName}`);
    console.log(`   - Old Member ID: ${result.oldMemberId}`);
    console.log(`   - New Member ID: ${result.newMemberId}`);
    console.log(`   - Removed from CAPI: ${result.removedFromCAPI ? 'Yes' : 'No (was not assigned)'}`);
    console.log(`   - Added to CATI: ${result.addedToCATI ? 'Yes' : 'No (already assigned)'}`);
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

module.exports = { main, convertCAPItoCATI, extractNumericMemberId };















