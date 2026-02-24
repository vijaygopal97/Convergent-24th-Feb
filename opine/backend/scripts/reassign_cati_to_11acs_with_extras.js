#!/usr/bin/env node

/**
 * Reassign all CATI interviewers (with AC + extras) to 11 specific ACs on default survey
 *
 * 1. Gets all CATI interviewers who currently have an AC assigned
 * 2. Adds extra interviewer IDs (10018, 10005, 10031, 10002, 10020) - assign or update AC
 * 3. Removes current AC and assigns each to one of the 11 ACs in a balanced way
 *
 * Usage: node scripts/reassign_cati_to_11acs_with_extras.js [surveyId]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Survey = require('../models/Survey');
const User = require('../models/User');

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

const ACS_TO_ASSIGN = [
  'WB105', 'WB023', 'WB116', 'WB022', 'WB008',
  'WB203', 'WB265', 'WB251', 'WB021', 'WB088', 'WB112'
];

const EXTRA_INTERVIEWER_IDS = ['10018', '10005', '10031', '10002', '10020'];

function loadACJson() {
  const data = fs.readFileSync(AC_JSON_PATH, 'utf8');
  const wbACs = JSON.parse(data).states['West Bengal'].assemblyConstituencies;
  const acMap = {};
  wbACs.forEach(ac => { acMap[ac.acCode] = ac.acName; });
  return acMap;
}

function formatACCodeForLookup(acCode) {
  if (acCode.startsWith('WB')) return acCode;
  const code = parseInt(acCode, 10);
  if (isNaN(code)) throw new Error(`Invalid AC code: ${acCode}`);
  return `WB${code.toString().padStart(3, '0')}`;
}

function findACName(acCode, acMap) {
  const lookupCode = formatACCodeForLookup(acCode);
  const acName = acMap[lookupCode];
  if (!acName) throw new Error(`AC name not found for code: ${lookupCode}`);
  return acName;
}

async function assignACToInterviewer(survey, memberId, acCode, acMap) {
  const acName = findACName(acCode, acMap);
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) throw new Error(`Interviewer with member ID ${memberId} not found`);

  if (!survey.catiInterviewers) survey.catiInterviewers = [];

  let assignment = survey.catiInterviewers.find(
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
  );

  if (!assignment) {
    assignment = {
      interviewer: user._id,
      assignedBy: user._id,
      assignedAt: new Date(),
      assignedACs: [],
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    };
    survey.catiInterviewers.push(assignment);
  }

  const previousACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
  assignment.assignedACs = [acName];

  return {
    success: true,
    memberId,
    acCode: formatACCodeForLookup(acCode),
    acName,
    interviewerName: `${user.firstName} ${user.lastName}`,
    previousACs,
    hadPreviousAssignment: previousACs.length > 0
  };
}

function distributeInterviewers(interviewers, acs) {
  const distribution = [];
  const acCount = acs.length;
  interviewers.forEach((interviewer, index) => {
    distribution.push({
      interviewer,
      acCode: acs[index % acCount]
    });
  });
  return distribution;
}

async function getCatiInterviewersWithAC(survey) {
  if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) return [];

  const interviewersWithAC = survey.catiInterviewers.filter(
    a => a.assignedACs && Array.isArray(a.assignedACs) && a.assignedACs.length > 0
  );
  if (interviewersWithAC.length === 0) return [];

  const interviewerIds = interviewersWithAC.map(a => a.interviewer);
  const users = await User.find({ _id: { $in: interviewerIds } });
  const userMap = {};
  users.forEach(u => { userMap[u._id.toString()] = u; });

  const results = interviewersWithAC.map(assignment => {
    const u = userMap[assignment.interviewer.toString()];
    return {
      memberId: u ? u.memberId : 'N/A',
      name: u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : 'Unknown',
      assignedACs: assignment.assignedACs || [],
      interviewerId: assignment.interviewer.toString()
    };
  });

  results.sort((a, b) => (parseInt(a.memberId) || 0) - (parseInt(b.memberId) || 0));
  return results;
}

async function main() {
  try {
    const surveyId = process.argv[2] || DEFAULT_SURVEY_ID;

    console.log('='.repeat(70));
    console.log('REASSIGN CATI INTERVIEWERS TO 11 ACS (WITH EXTRAS)');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
    console.log(`ACs: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log(`Extra interviewer IDs: ${EXTRA_INTERVIEWER_IDS.join(', ')}`);
    console.log('='.repeat(70));

    const acMap = loadACJson();
    console.log(`\n✅ Loaded ${Object.keys(acMap).length} AC mappings`);

    console.log('\n🔍 Verifying ACs...');
    ACS_TO_ASSIGN.forEach(acCode => {
      const acName = findACName(acCode, acMap);
      console.log(`  ✅ ${acCode}: ${acName}`);
    });

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('\n✅ Connected to MongoDB');

    const survey = await Survey.findById(surveyId);
    if (!survey) throw new Error(`Survey ${surveyId} not found`);
    console.log(`✅ Survey: ${survey.surveyName}`);

    const withAC = await getCatiInterviewersWithAC(survey);
    console.log(`\n📋 CATI interviewers with AC: ${withAC.length}`);

    const memberIdSet = new Set(withAC.map(i => String(i.memberId)));

    for (const mid of EXTRA_INTERVIEWER_IDS) {
      if (memberIdSet.has(mid)) continue;
      const user = await User.findOne({ memberId: mid });
      if (!user) {
        console.warn(`⚠️  Extra interviewer ${mid} not found in User collection, skipping`);
        continue;
      }
      withAC.push({
        memberId: user.memberId,
        name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        assignedACs: [],
        interviewerId: user._id.toString()
      });
      memberIdSet.add(mid);
    }

    const interviewers = withAC;
    console.log(`📋 Total to process: ${interviewers.length}`);

    if (interviewers.length === 0) {
      console.log('\n⚠️  No interviewers to process.');
      await mongoose.connection.close();
      process.exit(0);
    }

    const distribution = distributeInterviewers(interviewers, ACS_TO_ASSIGN);

    const acCounts = {};
    ACS_TO_ASSIGN.forEach(ac => acCounts[ac] = 0);
    distribution.forEach(d => acCounts[d.acCode]++);
    console.log('\n📋 Distribution plan:');
    ACS_TO_ASSIGN.forEach(acCode => {
      console.log(`  ${acCode} (${findACName(acCode, acMap)}): ${acCounts[acCode]} interviewers`);
    });

    const results = { successful: [], failed: [] };

    for (let i = 0; i < distribution.length; i++) {
      const { interviewer, acCode } = distribution[i];
      const progress = `[${i + 1}/${distribution.length}]`;
      try {
        console.log(`\n${progress} ${interviewer.memberId} - ${interviewer.name} → ${acCode}`);
        const result = await assignACToInterviewer(survey, interviewer.memberId, acCode, acMap);
        await survey.save();
        results.successful.push({ ...result, previousACs: interviewer.assignedACs });
      } catch (err) {
        console.error(`  ❌ ${err.message}`);
        results.failed.push({
          memberId: interviewer.memberId,
          name: interviewer.name,
          acCode,
          error: err.message
        });
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('DONE');
    console.log('='.repeat(70));
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    if (results.failed.length) {
      results.failed.forEach(f => console.log(`  ${f.memberId} (${f.name}): ${f.error}`));
    }
    console.log('='.repeat(70));

    await mongoose.connection.close();
    process.exit(results.failed.length ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Fatal:', err.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();
