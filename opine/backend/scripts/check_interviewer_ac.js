#!/usr/bin/env node

/**
 * Check AC Assignment for Interviewer
 */

const mongoose = require('mongoose');
const path = require('path');

const User = require('../models/User');
const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('❌ Error: Missing member ID');
      console.error('\nUsage: node check_interviewer_ac.js <memberId>');
      process.exit(1);
    }
    
    const memberId = args[0];
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find user by member ID
    const user = await User.findOne({ memberId: String(memberId) }).lean();
    
    if (!user) {
      console.log(`❌ User with Member ID ${memberId} not found`);
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('='.repeat(80));
    console.log('INTERVIEWER AC ASSIGNMENT CHECK');
    console.log('='.repeat(80));
    console.log(`Member ID: ${user.memberId}`);
    console.log(`Name: ${user.firstName} ${user.lastName}`);
    console.log(`Phone: ${user.phone}`);
    console.log(`Email: ${user.email}`);
    console.log(`User Type: ${user.userType}`);
    console.log(`Survey ID: ${SURVEY_ID}\n`);
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    
    // Find CATI assignment
    if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
      console.log('❌ No CATI interviewers assigned to this survey');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    const assignment = survey.catiInterviewers.find(
      a => a.interviewer.toString() === user._id.toString()
    );
    
    if (!assignment) {
      console.log('❌ This interviewer is NOT assigned to the survey as a CATI interviewer');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    console.log('✅ Interviewer is assigned to the survey');
    console.log(`   Status: ${assignment.status || 'N/A'}`);
    console.log(`   Assigned At: ${assignment.assignedAt ? new Date(assignment.assignedAt).toLocaleString() : 'N/A'}`);
    
    if (assignment.assignedACs && assignment.assignedACs.length > 0) {
      console.log(`\n📍 Assigned ACs (${assignment.assignedACs.length}):`);
      assignment.assignedACs.forEach((ac, index) => {
        console.log(`   ${index + 1}. ${ac}`);
      });
    } else {
      console.log('\n❌ No ACs assigned to this interviewer');
    }
    
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();



















