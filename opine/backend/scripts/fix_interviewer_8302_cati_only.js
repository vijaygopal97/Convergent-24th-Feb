#!/usr/bin/env node

/**
 * Fix interviewer 8302: Remove from CAPI, ensure CATI only on default survey
 *
 * Problem: 8302 is a CATI interviewer but was in both capiInterviewers and
 * catiInterviewers. getAvailableSurveys checks capiInterviewers first, so
 * they saw "Start CAPI Interview" instead of "Start CATI Interview".
 *
 * This script:
 * 1. Removes 8302 from survey.capiInterviewers on the default survey
 * 2. Ensures 8302 is in survey.catiInterviewers (adds if missing)
 *
 * Usage: node scripts/fix_interviewer_8302_cati_only.js [survey_id]
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const MEMBER_ID = '8302';

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const surveyId = process.argv[2] || DEFAULT_SURVEY_ID;
    const user = await User.findOne({ memberId: String(MEMBER_ID) });
    if (!user) {
      console.error(`❌ User with memberId "${MEMBER_ID}" not found`);
      process.exit(1);
    }
    console.log(`✅ Found user: ${user.firstName} ${user.lastName} (memberId: ${user.memberId})\n`);

    const survey = await Survey.findById(surveyId);
    if (!survey) {
      console.error(`❌ Survey ${surveyId} not found`);
      process.exit(1);
    }
    console.log(`✅ Survey: ${survey.surveyName} (${surveyId})\n`);

    const userIdStr = user._id.toString();

    // 1) Remove from CAPI
    let capiIndex = -1;
    if (survey.capiInterviewers && Array.isArray(survey.capiInterviewers)) {
      capiIndex = survey.capiInterviewers.findIndex(
        a => a.interviewer && a.interviewer.toString() === userIdStr
      );
    }
    if (capiIndex !== -1) {
      survey.capiInterviewers.splice(capiIndex, 1);
      survey.markModified('capiInterviewers');
      console.log('✅ Removed from capiInterviewers');
    } else {
      console.log('ℹ️  Not in capiInterviewers (no change)');
    }

    // 2) Ensure in CATI
    let catiIndex = -1;
    if (survey.catiInterviewers && Array.isArray(survey.catiInterviewers)) {
      catiIndex = survey.catiInterviewers.findIndex(
        a => a.interviewer && a.interviewer.toString() === userIdStr
      );
    }
    if (catiIndex !== -1) {
      console.log('✅ Already in catiInterviewers (no change)');
    } else {
      if (!survey.catiInterviewers) {
        survey.catiInterviewers = [];
      }
      survey.catiInterviewers.push({
        interviewer: user._id,
        assignedBy: user._id,
        assignedAt: new Date(),
        status: 'assigned',
        assignedACs: survey.catiInterviewers.length ? (survey.catiInterviewers[0].assignedACs || []) : [],
        maxInterviews: 0,
        completedInterviews: 0
      });
      survey.markModified('catiInterviewers');
      console.log('✅ Added to catiInterviewers');
    }

    await survey.save();
    console.log('\n✅ Survey saved. Interviewer 8302 will now see "Start CATI Interview" for this survey.\n');

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();
