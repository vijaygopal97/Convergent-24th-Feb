#!/usr/bin/env node

/**
 * Check interviewer AC assignment and pending respondents
 * Usage: node scripts/check_interviewer_respondents.js <memberId> [surveyId]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkInterviewerRespondents(memberId, surveyId) {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find user
    const user = await User.findOne({ memberId: String(memberId) });
    if (!user) {
      throw new Error(`Interviewer with member ID ${memberId} not found`);
    }

    console.log('='.repeat(70));
    console.log('INTERVIEWER INFORMATION');
    console.log('='.repeat(70));
    console.log(`Member ID: ${user.memberId}`);
    console.log(`Name: ${user.firstName} ${user.lastName}`);
    console.log(`User ID: ${user._id}`);
    console.log('='.repeat(70));

    // Find survey
    const survey = await Survey.findById(surveyId)
      .select('surveyName catiInterviewers')
      .lean();

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    console.log(`\n📊 Survey: ${survey.surveyName}`);
    console.log(`Survey ID: ${surveyId}\n`);

    // Find assignment
    const assignment = survey.catiInterviewers?.find(
      a => a.interviewer && a.interviewer.toString() === user._id.toString()
    );

    if (!assignment) {
      console.log('❌ No CATI assignment found for this interviewer');
      return;
    }

    console.log('='.repeat(70));
    console.log('AC ASSIGNMENT');
    console.log('='.repeat(70));
    console.log(`Status: ${assignment.status}`);
    console.log(`Assigned ACs: ${assignment.assignedACs?.length || 0}`);
    
    if (assignment.assignedACs && assignment.assignedACs.length > 0) {
      console.log('\nAssigned AC Names:');
      assignment.assignedACs.forEach((acName, index) => {
        console.log(`  ${index + 1}. ${acName}`);
      });
    } else {
      console.log('\n⚠️  No ACs assigned to this interviewer');
    }
    console.log('='.repeat(70));

    // Check pending respondents for assigned ACs
    console.log('\n📊 CHECKING PENDING RESPONDENTS\n');

    if (!assignment.assignedACs || assignment.assignedACs.length === 0) {
      console.log('⚠️  Cannot check respondents - no ACs assigned');
      return;
    }

    const acStats = [];

    for (const acName of assignment.assignedACs) {
      // Check in CatiRespondentQueue
      const queueCount = await CatiRespondentQueue.countDocuments({
        survey: surveyId,
        status: 'pending',
        'respondentContact.ac': acName
      });

      // Check assigned status (stuck respondents)
      const assignedCount = await CatiRespondentQueue.countDocuments({
        survey: surveyId,
        status: 'assigned',
        'respondentContact.ac': acName
      });

      // Check completed
      const completedCount = await CatiRespondentQueue.countDocuments({
        survey: surveyId,
        status: 'completed',
        'respondentContact.ac': acName
      });

      // Check all statuses
      const totalCount = await CatiRespondentQueue.countDocuments({
        survey: surveyId,
        'respondentContact.ac': acName
      });

      acStats.push({
        acName,
        pending: queueCount,
        assigned: assignedCount,
        completed: completedCount,
        total: totalCount
      });
    }

    console.log('='.repeat(70));
    console.log('RESPONDENT STATISTICS BY AC');
    console.log('='.repeat(70));
    
    let totalPending = 0;
    let totalAssigned = 0;
    let totalCompleted = 0;
    let totalAll = 0;

    acStats.forEach((stat, index) => {
      console.log(`\n${index + 1}. AC: ${stat.acName}`);
      console.log(`   Pending:   ${stat.pending} ${stat.pending === 0 ? '❌' : '✅'}`);
      console.log(`   Assigned:  ${stat.assigned} ${stat.assigned > 0 ? '⚠️  (may be stuck)' : ''}`);
      console.log(`   Completed: ${stat.completed}`);
      console.log(`   Total:     ${stat.total}`);
      
      totalPending += stat.pending;
      totalAssigned += stat.assigned;
      totalCompleted += stat.completed;
      totalAll += stat.total;
    });

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Pending:   ${totalPending} ${totalPending === 0 ? '❌ NO PENDING RESPONDENTS' : '✅'}`);
    console.log(`Total Assigned:  ${totalAssigned} ${totalAssigned > 0 ? '⚠️  (may include stuck)' : ''}`);
    console.log(`Total Completed: ${totalCompleted}`);
    console.log(`Total All:        ${totalAll}`);
    console.log('='.repeat(70));

    // Check if there are any pending respondents at all (not filtered by AC)
    const anyPending = await CatiRespondentQueue.countDocuments({
      survey: surveyId,
      status: 'pending'
    });

    console.log(`\n📊 Total pending respondents in survey (all ACs): ${anyPending}`);

    if (totalPending === 0 && anyPending > 0) {
      console.log('\n⚠️  ISSUE IDENTIFIED:');
      console.log(`   - There are ${anyPending} pending respondents in the survey`);
      console.log(`   - But NONE are from the assigned ACs: ${assignment.assignedACs.join(', ')}`);
      console.log(`   - This is why the interviewer gets "No Pending Respondents" error`);
    } else if (totalPending === 0 && anyPending === 0) {
      console.log('\n⚠️  ISSUE IDENTIFIED:');
      console.log(`   - There are NO pending respondents in the entire survey`);
      console.log(`   - All respondents may be completed, assigned, or not yet loaded`);
    }

    // Check for stuck assignments (assigned > 30 minutes ago)
    if (totalAssigned > 0) {
      console.log('\n🔍 Checking for stuck assignments (assigned > 30 minutes ago)...');
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      
      for (const acName of assignment.assignedACs) {
        const stuckCount = await CatiRespondentQueue.countDocuments({
          survey: surveyId,
          status: 'assigned',
          ac: acName,
          assignedAt: { $lt: thirtyMinutesAgo }
        });
        
        if (stuckCount > 0) {
          console.log(`   ⚠️  ${acName}: ${stuckCount} stuck assignments`);
        }
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Main
const memberId = process.argv[2];
const surveyId = process.argv[3] || DEFAULT_SURVEY_ID;

if (!memberId) {
  console.error('Usage: node scripts/check_interviewer_respondents.js <memberId> [surveyId]');
  process.exit(1);
}

checkInterviewerRespondents(memberId, surveyId);

