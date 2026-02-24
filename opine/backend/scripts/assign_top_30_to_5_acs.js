#!/usr/bin/env node

/**
 * Assign Top 30 CATI Interviewers to 5 ACs
 * 
 * This script:
 * 1. Reads the top 30 CATI interviewers from the last 3 days
 * 2. Removes their existing AC assignments
 * 3. Assigns them evenly to 5 ACs (6 interviewers per AC)
 * 
 * ACs to assign:
 * - WB182
 * - WB162
 * - WB011
 * - WB116
 * - WB283
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const ACS_TO_ASSIGN = ['WB182', 'WB162', 'WB011', 'WB116', 'WB283'];
const INTERVIEWERS_PER_AC = 6; // 30 interviewers / 5 ACs = 6 per AC
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

/**
 * Load AC names from JSON
 */
function loadACNames() {
  const data = JSON.parse(fs.readFileSync(AC_JSON_PATH, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  return acMap;
}

/**
 * Assign a single AC to an interviewer (removes existing ACs first)
 */
async function assignACToInterviewer(surveyId, interviewerId, acCode, acName) {
  try {
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      throw new Error(`Survey not found: ${surveyId}`);
    }

    // Find the interviewer assignment in catiInterviewers
    if (!survey.catiInterviewers || !Array.isArray(survey.catiInterviewers)) {
      throw new Error('Survey does not have catiInterviewers array');
    }

    const assignmentIndex = survey.catiInterviewers.findIndex(
      a => a.interviewer && a.interviewer.toString() === interviewerId.toString()
    );

    if (assignmentIndex === -1) {
      throw new Error(`Interviewer ${interviewerId} not found in catiInterviewers`);
    }

    const assignment = survey.catiInterviewers[assignmentIndex];

    // Remove existing ACs
    if (assignment.assignedACs && assignment.assignedACs.length > 0) {
      console.log(`   🔄 Removing existing ACs: ${assignment.assignedACs.join(', ')}`);
      assignment.assignedACs = [];
    }

    // Add new AC (using AC name, not code)
    if (!assignment.assignedACs.includes(acName)) {
      assignment.assignedACs.push(acName);
      console.log(`   ✅ Assigned AC: ${acName} (${acCode})`);
    }

    // Mark the array as modified
    survey.markModified('catiInterviewers');
    await survey.save();

    return { success: true, previousACs: assignment.assignedACs || [] };
  } catch (error) {
    console.error(`   ❌ Error assigning AC ${acCode} to interviewer ${interviewerId}:`, error.message);
    throw error;
  }
}

/**
 * Get top 30 CATI interviewers from last 3 days
 */
async function getTop30CATIInterviewers() {
  const SurveyResponse = require('../models/SurveyResponse');
  
  // Calculate date ranges (IST timezone)
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  
  const todayIST = new Date(istNow);
  todayIST.setUTCHours(0, 0, 0, 0);
  
  function getISTDateStartUTC(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  }
  
  function getISTDateEndUTC(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
  }
  
  const todayStart = getISTDateStartUTC(todayIST.getUTCFullYear(), todayIST.getUTCMonth() + 1, todayIST.getUTCDate());
  const todayEnd = getISTDateEndUTC(todayIST.getUTCFullYear(), todayIST.getUTCMonth() + 1, todayIST.getUTCDate());
  
  const yesterdayIST = new Date(todayIST);
  yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
  const yesterdayStart = getISTDateStartUTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth() + 1, yesterdayIST.getUTCDate());
  const yesterdayEnd = getISTDateEndUTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth() + 1, yesterdayIST.getUTCDate());
  
  const dayBeforeIST = new Date(yesterdayIST);
  dayBeforeIST.setUTCDate(dayBeforeIST.getUTCDate() - 1);
  const dayBeforeStart = getISTDateStartUTC(dayBeforeIST.getUTCFullYear(), dayBeforeIST.getUTCMonth() + 1, dayBeforeIST.getUTCDate());
  const dayBeforeEnd = getISTDateEndUTC(dayBeforeIST.getUTCFullYear(), dayBeforeIST.getUTCMonth() + 1, dayBeforeIST.getUTCDate());
  
  const threeDaysAgoStart = dayBeforeStart;
  const threeDaysAgoEnd = todayEnd;
  
  const allResponses = await SurveyResponse.aggregate([
    {
      $match: {
        interviewMode: 'cati',
        startTime: { $gte: threeDaysAgoStart, $lt: threeDaysAgoEnd }
      }
    },
    {
      $group: {
        _id: '$interviewer',
        responseCount: { $sum: 1 },
        todayCount: {
          $sum: {
            $cond: [
              { $and: [
                { $gte: ['$startTime', todayStart] },
                { $lt: ['$startTime', todayEnd] }
              ]},
              1,
              0
            ]
          }
        }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'interviewerDetails'
      }
    },
    {
      $unwind: '$interviewerDetails'
    },
    {
      $project: {
        _id: 0,
        interviewerId: '$_id',
        memberId: '$interviewerDetails.memberId',
        phone: '$interviewerDetails.phone',
        firstName: '$interviewerDetails.firstName',
        lastName: '$interviewerDetails.lastName',
        responseCount: 1,
        workedToday: { $gt: ['$todayCount', 0] }
      }
    }
  ]);
  
  // Sort: Today's workers first, then by response count
  const sorted = allResponses.sort((a, b) => {
    if (a.workedToday && !b.workedToday) return -1;
    if (!a.workedToday && b.workedToday) return 1;
    return b.responseCount - a.responseCount;
  });
  
  return sorted.slice(0, 30);
}

/**
 * Distribute interviewers evenly across ACs
 */
function distributeInterviewers(interviewers, acs) {
  const distribution = {};
  acs.forEach(ac => {
    distribution[ac] = [];
  });
  
  // Round-robin distribution
  interviewers.forEach((interviewer, index) => {
    const acIndex = index % acs.length;
    const ac = acs[acIndex];
    distribution[ac].push(interviewer);
  });
  
  return distribution;
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Load AC names
    console.log('📖 Loading AC names from JSON...');
    const acNameMap = loadACNames();
    const acCodeToName = {};
    ACS_TO_ASSIGN.forEach(code => {
      acCodeToName[code] = acNameMap[code];
      if (!acCodeToName[code]) {
        throw new Error(`AC name not found for code: ${code}`);
      }
    });
    console.log('✅ AC names loaded:\n');
    ACS_TO_ASSIGN.forEach(code => {
      console.log(`   ${code}: ${acCodeToName[code]}`);
    });
    console.log('');
    
    console.log('='.repeat(80));
    console.log('ASSIGN TOP 30 CATI INTERVIEWERS TO 5 ACs');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${DEFAULT_SURVEY_ID}`);
    console.log(`ACs to assign: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log(`Interviewers per AC: ${INTERVIEWERS_PER_AC}\n`);
    
    // Get top 30 interviewers
    console.log('🔍 Fetching top 30 CATI interviewers from last 3 days...');
    const top30 = await getTop30CATIInterviewers();
    console.log(`✅ Found ${top30.length} interviewers\n`);
    
    if (top30.length !== 30) {
      console.log(`⚠️  Warning: Expected 30 interviewers, found ${top30.length}`);
    }
    
    // Distribute interviewers across ACs
    console.log('📊 Distributing interviewers across ACs...');
    const distribution = distributeInterviewers(top30, ACS_TO_ASSIGN);
    
    // Display distribution plan
    console.log('\n📋 Distribution Plan:');
    ACS_TO_ASSIGN.forEach(ac => {
      console.log(`\n   ${ac}: ${distribution[ac].length} interviewers`);
      distribution[ac].forEach((interviewer, idx) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`      ${idx + 1}. ${interviewer.memberId || 'N/A'} - ${name} (${interviewer.responseCount} responses)`);
      });
    });
    
    // Confirm before proceeding
    console.log('\n' + '='.repeat(80));
    console.log('⚠️  This will REMOVE existing AC assignments and assign new ones');
    console.log('='.repeat(80));
    console.log('\nProceeding with assignments...\n');
    
    // Assign ACs
    const results = {
      success: [],
      errors: []
    };
    
    for (const ac of ACS_TO_ASSIGN) {
      console.log(`\n📌 Assigning AC: ${ac}`);
      console.log('─'.repeat(60));
      
      for (const interviewer of distribution[ac]) {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`\n   Interviewer: ${interviewer.memberId || 'N/A'} - ${name}`);
        console.log(`   Phone: ${interviewer.phone || 'N/A'}`);
        
        try {
          const acName = acCodeToName[ac];
          await assignACToInterviewer(DEFAULT_SURVEY_ID, interviewer.interviewerId, ac, acName);
          results.success.push({
            interviewerId: interviewer.interviewerId,
            memberId: interviewer.memberId,
            name: name,
            phone: interviewer.phone,
            acCode: ac,
            acName: acName
          });
        } catch (error) {
          results.errors.push({
            interviewerId: interviewer.interviewerId,
            memberId: interviewer.memberId,
            name: name,
            phone: interviewer.phone,
            acCode: ac,
            acName: acCodeToName[ac],
            error: error.message
          });
        }
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('ASSIGNMENT SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Successfully assigned: ${results.success.length}`);
    console.log(`❌ Errors: ${results.errors.length}\n`);
    
    if (results.success.length > 0) {
      console.log('✅ Successful Assignments:');
      ACS_TO_ASSIGN.forEach(acCode => {
        const acName = acCodeToName[acCode];
        const acAssignments = results.success.filter(r => r.acCode === acCode);
        console.log(`\n   ${acCode} (${acName}): ${acAssignments.length} interviewers`);
        acAssignments.forEach((assignment, idx) => {
          console.log(`      ${idx + 1}. ${assignment.memberId || 'N/A'} - ${assignment.name}`);
        });
      });
    }
    
    if (results.errors.length > 0) {
      console.log('\n❌ Errors:');
      results.errors.forEach(error => {
        console.log(`   ${error.memberId || 'N/A'} - ${error.name}: ${error.error}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();

