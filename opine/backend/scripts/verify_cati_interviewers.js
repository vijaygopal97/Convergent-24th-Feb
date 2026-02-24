#!/usr/bin/env node

/**
 * Verify CATI Interviewers Created
 * 
 * This script verifies that the interviewers were created and assigned correctly.
 */

const mongoose = require('mongoose');
const path = require('path');
const User = require('../models/User');
const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';
const MEMBER_IDS = ['320', '321', '322', '323', '324', '325', '326', '327', '328', '329', '330', '331'];

async function verifyInterviewers() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('VERIFY CATI INTERVIEWERS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}\n`);
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    
    console.log(`✅ Survey: ${survey.surveyName}\n`);
    
    // Check each member ID
    const foundInterviewers = [];
    const missingInterviewers = [];
    
    for (const memberId of MEMBER_IDS) {
      const user = await User.findOne({ memberId: memberId }).lean();
      if (user && user.userType === 'interviewer' && user.interviewModes === 'CATI (Telephonic interview)') {
        // Check if assigned to survey
        const assignment = survey.catiInterviewers?.find(
          a => a.interviewer.toString() === user._id.toString()
        );
        
        foundInterviewers.push({
          memberId: user.memberId,
          name: `${user.firstName} ${user.lastName}`,
          phone: user.phone,
          email: user.email,
          assignedToSurvey: !!assignment,
          assignedACs: assignment?.assignedACs || [],
          status: assignment?.status || 'N/A'
        });
      } else if (user) {
        console.log(`⚠️  User ${memberId} exists but is not a CATI interviewer`);
      } else {
        missingInterviewers.push(memberId);
      }
    }
    
    // Display results
    console.log('='.repeat(80));
    console.log('CATI INTERVIEWERS FOUND');
    console.log('='.repeat(80));
    console.log(`Total found: ${foundInterviewers.length}\n`);
    
    foundInterviewers.forEach((interviewer, index) => {
      console.log(`${index + 1}. Member ID: ${interviewer.memberId}`);
      console.log(`   Name: ${interviewer.name}`);
      console.log(`   Phone: ${interviewer.phone}`);
      console.log(`   Email: ${interviewer.email}`);
      console.log(`   Assigned to Survey: ${interviewer.assignedToSurvey ? '✅ Yes' : '❌ No'}`);
      if (interviewer.assignedToSurvey) {
        console.log(`   Assigned ACs: ${interviewer.assignedACs.length > 0 ? interviewer.assignedACs.join(', ') : 'None'}`);
        console.log(`   Status: ${interviewer.status}`);
      }
      console.log('');
    });
    
    if (missingInterviewers.length > 0) {
      console.log('⚠️  Missing Member IDs:', missingInterviewers.join(', '));
    }
    
    // Check for interviewers with Member IDs 320-331
    console.log('='.repeat(80));
    console.log('ALL CATI INTERVIEWERS (Member IDs 320-331)');
    console.log('='.repeat(80));
    
    const allCatiInterviewers = await User.find({
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      memberId: { $in: MEMBER_IDS.map(id => String(id)) }
    })
    .select('memberId firstName lastName phone email')
    .sort({ memberId: 1 })
    .lean();
    
    console.log(`Total CATI interviewers found: ${allCatiInterviewers.length}\n`);
    allCatiInterviewers.forEach((interviewer, index) => {
      console.log(`${index + 1}. ${interviewer.memberId} - ${interviewer.firstName} ${interviewer.lastName} (${interviewer.phone})`);
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

verifyInterviewers();






















