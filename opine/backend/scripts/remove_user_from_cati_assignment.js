#!/usr/bin/env node

/**
 * Remove User from CATI Assignment
 * 
 * This script removes a user from CATI assignment on a survey
 * without affecting anything else.
 * 
 * Usage:
 *   node remove_user_from_cati_assignment.js <memberId|phone|userId> [survey_id]
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

/**
 * Remove user from CATI assignment
 */
async function removeUserFromCATIAssignment(surveyId, userIdentifier) {
  try {
    console.log(`\n🔍 Finding user with identifier: ${userIdentifier}`);
    
    // Try to find user by memberId, phone, or _id
    let user = null;
    
    // Try memberId first
    user = await User.findOne({ memberId: String(userIdentifier) });
    if (user) {
      console.log(`✅ Found user by Member ID: ${user.memberId}`);
    }
    
    // Try phone if not found
    if (!user) {
      const phoneVariations = [
        userIdentifier,
        `+${userIdentifier}`,
        `+91${userIdentifier}`,
        `91${userIdentifier}`
      ];
      user = await User.findOne({ $or: phoneVariations.map(p => ({ phone: p })) });
      if (user) {
        console.log(`✅ Found user by Phone: ${user.phone}`);
      }
    }
    
    // Try _id if not found
    if (!user && mongoose.Types.ObjectId.isValid(userIdentifier)) {
      user = await User.findById(userIdentifier);
      if (user) {
        console.log(`✅ Found user by User ID: ${user._id}`);
      }
    }
    
    if (!user) {
      throw new Error(`User not found with identifier: ${userIdentifier}`);
    }
    
    console.log(`   User: ${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A');
    console.log(`   Member ID: ${user.memberId || 'N/A'}`);
    console.log(`   Phone: ${user.phone || 'N/A'}`);
    console.log(`   User ID: ${user._id}`);
    
    // Find survey
    console.log(`\n🔍 Finding survey: ${surveyId}`);
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      throw new Error(`Survey not found: ${surveyId}`);
    }
    
    console.log(`✅ Found survey: ${survey.surveyName}`);
    
    // Check if user is assigned in catiInterviewers
    if (!survey.catiInterviewers || !Array.isArray(survey.catiInterviewers)) {
      console.log(`⚠️  Survey does not have catiInterviewers array`);
      return {
        success: true,
        removed: false,
        message: 'User was not assigned (no catiInterviewers array)',
        user: {
          memberId: user.memberId,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          phone: user.phone
        }
      };
    }
    
    // Find assignment
    const assignmentIndex = survey.catiInterviewers.findIndex(
      a => a.interviewer && a.interviewer.toString() === user._id.toString()
    );
    
    if (assignmentIndex === -1) {
      console.log(`⚠️  User is not assigned to this survey for CATI`);
      return {
        success: true,
        removed: false,
        message: 'User was not assigned to this survey',
        user: {
          memberId: user.memberId,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          phone: user.phone
        }
      };
    }
    
    const assignment = survey.catiInterviewers[assignmentIndex];
    const assignedACs = assignment.assignedACs || [];
    
    console.log(`\n📋 Current Assignment Details:`);
    console.log(`   Assigned ACs: ${assignedACs.length > 0 ? assignedACs.join(', ') : 'None'}`);
    console.log(`   Status: ${assignment.status || 'N/A'}`);
    console.log(`   Assigned At: ${assignment.assignedAt || 'N/A'}`);
    
    // Remove assignment
    console.log(`\n🗑️  Removing CATI assignment...`);
    survey.catiInterviewers.splice(assignmentIndex, 1);
    
    // Mark as modified
    survey.markModified('catiInterviewers');
    await survey.save();
    
    console.log(`✅ Successfully removed user from CATI assignment`);
    
    return {
      success: true,
      removed: true,
      message: 'User removed from CATI assignment',
      user: {
        memberId: user.memberId,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        phone: user.phone,
        userId: user._id.toString()
      },
      previousAssignment: {
        assignedACs: assignedACs,
        status: assignment.status,
        assignedAt: assignment.assignedAt
      }
    };
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('❌ Error: User identifier is required');
      console.error('\nUsage: node remove_user_from_cati_assignment.js <memberId|phone|userId> [survey_id]');
      console.error('\nExamples:');
      console.error('  node remove_user_from_cati_assignment.js 90012');
      console.error('  node remove_user_from_cati_assignment.js 8420045700');
      console.error('  node remove_user_from_cati_assignment.js 698979c6fe817349e515292a');
      console.error('  node remove_user_from_cati_assignment.js 90012 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const userIdentifier = args[0];
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(80));
    console.log('REMOVE USER FROM CATI ASSIGNMENT');
    console.log('='.repeat(80));
    console.log(`User Identifier: ${userIdentifier}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(80));
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Remove assignment
    const result = await removeUserFromCATIAssignment(surveyId, userIdentifier);
    
    // Print results
    console.log('\n' + '='.repeat(80));
    console.log('REMOVAL RESULT');
    console.log('='.repeat(80));
    
    if (result.removed) {
      console.log(`✅ Successfully removed user from CATI assignment`);
      console.log(`   User: ${result.user.name} (${result.user.memberId})`);
      console.log(`   Phone: ${result.user.phone}`);
      if (result.previousAssignment.assignedACs.length > 0) {
        console.log(`   Previous ACs: ${result.previousAssignment.assignedACs.join(', ')}`);
      }
    } else {
      console.log(`ℹ️  ${result.message}`);
      console.log(`   User: ${result.user.name} (${result.user.memberId})`);
      console.log(`   Phone: ${result.user.phone}`);
    }
    
    console.log('='.repeat(80));
    
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

module.exports = { main, removeUserFromCATIAssignment };























