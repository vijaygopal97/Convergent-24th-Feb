#!/usr/bin/env node

/**
 * Check AC Name Mismatch
 * 
 * This script checks if there are AC name mismatches between assigned ACs and queue ACs
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const surveyId = DEFAULT_SURVEY_ID;
    const memberId = '10007';
    
    const user = await User.findOne({ memberId });
    if (!user) {
      throw new Error(`User with memberId ${memberId} not found`);
    }
    
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }
    
    const assignment = survey.catiInterviewers.find(a => 
      a.interviewer && a.interviewer.toString() === user._id.toString()
    );
    
    if (!assignment) {
      throw new Error('Assignment not found');
    }
    
    console.log('\n📋 Assigned ACs:', assignment.assignedACs);
    
    // Check actual AC names in queue for assigned ACs
    const queueACs = await CatiRespondentQueue.distinct('respondentContact.ac', {
      survey: surveyId,
      'respondentContact.ac': { $in: assignment.assignedACs }
    });
    
    console.log('📋 AC names in queue (for assigned ACs):', queueACs);
    
    // Check for case/whitespace mismatches
    const assignedACsLower = assignment.assignedACs.map(ac => ac.toLowerCase().trim());
    const queueACsLower = queueACs.map(ac => (ac || '').toLowerCase().trim());
    
    console.log('\n🔍 Checking for mismatches:');
    assignment.assignedACs.forEach(assignedAC => {
      const assignedLower = assignedAC.toLowerCase().trim();
      const found = queueACsLower.some(q => q === assignedLower);
      console.log(`  ${assignedAC}: ${found ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
    });
    
    // Check recent assignments to this interviewer
    const recentAssignments = await CatiRespondentQueue.find({
      survey: surveyId,
      assignedTo: user._id,
      status: { $in: ['assigned', 'completed'] }
    })
    .sort({ assignedAt: -1 })
    .limit(20)
    .select('respondentContact.ac status assignedAt')
    .lean();
    
    console.log('\n📊 Recent assignments to this interviewer (last 20):');
    const acCounts = {};
    recentAssignments.forEach((r) => {
      const ac = r.respondentContact?.ac || 'NO AC';
      acCounts[ac] = (acCounts[ac] || 0) + 1;
    });
    
    Object.entries(acCounts).sort((a, b) => b[1] - a[1]).forEach(([ac, count]) => {
      const isAssigned = assignment.assignedACs.some(a => a.toLowerCase().trim() === ac.toLowerCase().trim());
      console.log(`  ${ac}: ${count} assignments ${isAssigned ? '✅ (ASSIGNED)' : '❌ (NOT ASSIGNED!)'}`);
    });
    
    // Check if there are any assignments from non-assigned ACs
    const nonAssignedCount = recentAssignments.filter(r => {
      const ac = r.respondentContact?.ac;
      if (!ac) return true;
      return !assignment.assignedACs.some(a => a.toLowerCase().trim() === ac.toLowerCase().trim());
    }).length;
    
    if (nonAssignedCount > 0) {
      console.log(`\n⚠️  WARNING: ${nonAssignedCount} out of ${recentAssignments.length} recent assignments are from NON-ASSIGNED ACs!`);
      console.log('   This indicates the filtering logic is not working correctly.');
    } else {
      console.log(`\n✅ All recent assignments are from assigned ACs`);
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

















































