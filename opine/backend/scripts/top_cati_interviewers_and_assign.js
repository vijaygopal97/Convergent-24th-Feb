#!/usr/bin/env node

/**
 * Top CATI Interviewers and AC Assignment
 * 
 * This script:
 * 1. Finds top CATI interviewers who generated most responses yesterday and today
 * 2. Takes top 6 interviewers
 * 3. Assigns 3 ACs (WB251, WB255, WB203) evenly - 2 interviewers per AC
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

/**
 * Load assembly constituencies JSON
 */
function loadACJson() {
  const data = JSON.parse(fs.readFileSync(AC_JSON_PATH, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  
  // Create a map: acCode -> acName
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  
  return acMap;
}

/**
 * Format AC code for JSON lookup (e.g., 251 -> WB251, 3 -> WB003)
 */
function formatACCodeForLookup(acCode) {
  // If already in WB format, use as is, otherwise format it
  if (acCode.startsWith('WB')) {
    return acCode;
  }
  const code = parseInt(acCode, 10);
  if (isNaN(code)) {
    throw new Error(`Invalid AC code: ${acCode}`);
  }
  return `WB${code.toString().padStart(3, '0')}`;
}

/**
 * Find AC name from JSON
 */
function findACName(acCode, acMap) {
  const lookupCode = formatACCodeForLookup(acCode);
  const acName = acMap[lookupCode];
  
  if (!acName) {
    throw new Error(`AC name not found for code: ${lookupCode}`);
  }
  
  return acName;
}

/**
 * Get date range for yesterday and today
 */
function getDateRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // End of today
  const endOfToday = new Date(today);
  endOfToday.setDate(endOfToday.getDate() + 1);
  
  return {
    startDate: yesterday,
    endDate: endOfToday
  };
}

/**
 * Find top CATI interviewers
 */
async function findTopCatiInterviewers(surveyId, limit = 6) {
  const { startDate, endDate } = getDateRange();
  
  console.log(`\n📊 Finding CATI responses from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  // Aggregate to count responses by interviewer
  const pipeline = [
    {
      $match: {
        survey: new mongoose.Types.ObjectId(surveyId),
        interviewMode: 'cati',
        createdAt: {
          $gte: startDate,
          $lt: endDate
        }
      }
    },
    {
      $group: {
        _id: '$interviewer',
        responseCount: { $sum: 1 }
      }
    },
    {
      $sort: { responseCount: -1 }
    },
    {
      $limit: limit
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'interviewerInfo'
      }
    },
    {
      $unwind: {
        path: '$interviewerInfo',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        interviewerId: '$_id',
        responseCount: 1,
        memberId: '$interviewerInfo.memberId',
        firstName: '$interviewerInfo.firstName',
        lastName: '$interviewerInfo.lastName'
      }
    }
  ];
  
  const results = await SurveyResponse.aggregate(pipeline);
  
  return results;
}

/**
 * Assign AC to interviewer
 */
async function assignACToInterviewer(survey, interviewerId, acCode, acMap) {
  // Find AC name
  const acName = findACName(acCode, acMap);
  
  // Find user
  const user = await User.findById(interviewerId);
  if (!user) {
    throw new Error(`Interviewer with ID ${interviewerId} not found`);
  }
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  // Find or create interviewer assignment in survey
  let assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === interviewerId.toString()
  );
  
  if (!assignment) {
    // Create new assignment
    assignment = {
      interviewer: interviewerId,
      assignedBy: interviewerId,
      assignedAt: new Date(),
      assignedACs: [],
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    };
    survey.catiInterviewers.push(assignment);
  }
  
  // Remove all existing ACs and assign only the new one
  const previousACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
  assignment.assignedACs = [acName];
  
  await survey.save();
  
  return {
    success: true,
    memberId: user.memberId,
    interviewerName: `${user.firstName} ${user.lastName}`,
    acCode: formatACCodeForLookup(acCode),
    acName,
    previousACs
  };
}

/**
 * Main function
 */
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Find top 6 CATI interviewers
    console.log('\n' + '='.repeat(70));
    console.log('FINDING TOP 6 CATI INTERVIEWERS');
    console.log('='.repeat(70));
    
    const topInterviewers = await findTopCatiInterviewers(DEFAULT_SURVEY_ID, 6);
    
    if (topInterviewers.length === 0) {
      console.log('❌ No CATI interviewers found for yesterday and today');
      await mongoose.connection.close();
      process.exit(1);
    }
    
    console.log(`\n✅ Found ${topInterviewers.length} top interviewers:\n`);
    topInterviewers.forEach((interviewer, index) => {
      console.log(`  ${index + 1}. ${interviewer.firstName} ${interviewer.lastName} (${interviewer.memberId}): ${interviewer.responseCount} responses`);
    });
    
    // ACs to assign
    const acsToAssign = ['WB251', 'WB255', 'WB203'];
    
    // Distribute ACs evenly (2 interviewers per AC)
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNING ACs TO TOP 6 INTERVIEWERS');
    console.log('='.repeat(70));
    console.log(`ACs to assign: ${acsToAssign.join(', ')}`);
    console.log(`Distribution: 2 interviewers per AC\n`);
    
    // Load survey
    const survey = await Survey.findById(DEFAULT_SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${DEFAULT_SURVEY_ID} not found`);
    }
    
    const assignmentResults = [];
    
    // Assign ACs: first 2 get WB251, next 2 get WB255, last 2 get WB203
    for (let i = 0; i < topInterviewers.length; i++) {
      const interviewer = topInterviewers[i];
      let acIndex;
      
      if (i < 2) {
        acIndex = 0; // WB251
      } else if (i < 4) {
        acIndex = 1; // WB255
      } else {
        acIndex = 2; // WB203
      }
      
      const acCode = acsToAssign[acIndex];
      
      console.log(`\n📋 Assigning ${acCode} to interviewer ${interviewer.memberId} (${interviewer.firstName} ${interviewer.lastName})...`);
      
      try {
        const result = await assignACToInterviewer(
          survey,
          interviewer.interviewerId,
          acCode,
          acMap
        );
        
        assignmentResults.push({
          ...result,
          responseCount: interviewer.responseCount
        });
        
        console.log(`   ✅ Assigned ${result.acName} (${result.acCode})`);
        if (result.previousACs.length > 0) {
          console.log(`   🔄 Removed previous ACs: ${result.previousACs.join(', ')}`);
        }
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        assignmentResults.push({
          success: false,
          memberId: interviewer.memberId,
          error: error.message
        });
      }
    }
    
    // Reload survey to show final state
    await survey.populate('catiInterviewers.interviewer', 'firstName lastName memberId');
    
    console.log('\n' + '='.repeat(70));
    console.log('FINAL ASSIGNMENTS SUMMARY');
    console.log('='.repeat(70));
    
    for (const result of assignmentResults) {
      if (result.success) {
        console.log(`\n📋 ${result.interviewerName} (${result.memberId}):`);
        console.log(`   Responses: ${result.responseCount}`);
        console.log(`   Assigned AC: ${result.acName} (${result.acCode})`);
      } else {
        console.log(`\n❌ ${result.memberId}: ${result.error}`);
      }
    }
    
    // Group by AC
    console.log('\n' + '='.repeat(70));
    console.log('GROUPED BY AC');
    console.log('='.repeat(70));
    
    for (const acCode of acsToAssign) {
      const acName = findACName(acCode, acMap);
      const assigned = assignmentResults.filter(r => r.success && r.acCode === formatACCodeForLookup(acCode));
      
      console.log(`\n📋 ${acName} (${acCode}):`);
      assigned.forEach(r => {
        console.log(`   - ${r.interviewerName} (${r.memberId}) - ${r.responseCount} responses`);
      });
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












































