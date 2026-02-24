#!/usr/bin/env node

/**
 * Reassign Top CATI Interviewers Script
 * 
 * This script:
 * 1. Finds top 12 CATI interviewers who collected most responses from yesterday to now
 * 2. Removes their current AC assignments
 * 3. Assigns 6 ACs (2 interviewers per AC) to these top 12 interviewers
 * 
 * Usage:
 *   node reassign_top_cati_interviewers.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

// ACs to assign (each will be assigned to 2 interviewers)
const ACS_TO_ASSIGN = ['WB159', 'WB116', 'WB170', 'WB14', 'WB171', 'WB263'];

/**
 * Get IST date range (yesterday to now)
 */
function getISTDateRange() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  
  // Get current IST time
  const istNow = new Date(now.getTime() + istOffset);
  
  // Get yesterday IST (start of yesterday)
  const yesterdayIST = new Date(istNow);
  yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
  yesterdayIST.setUTCHours(0, 0, 0, 0);
  
  // Convert back to UTC for database query
  const startDateUTC = new Date(yesterdayIST.getTime() - istOffset);
  const endDateUTC = now;
  
  return {
    startDate: startDateUTC,
    endDate: endDateUTC,
    startDateIST: yesterdayIST,
    endDateIST: istNow
  };
}

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
 * Format AC code for JSON lookup (e.g., WB159 -> WB159, WB14 -> WB014, 159 -> WB159)
 */
function formatACCodeForLookup(acCode) {
  if (acCode.startsWith('WB')) {
    // Extract the number part and pad it
    const numberPart = acCode.substring(2);
    const code = parseInt(numberPart, 10);
    if (isNaN(code)) {
      throw new Error(`Invalid AC code: ${acCode}`);
    }
    return `WB${code.toString().padStart(3, '0')}`;
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
 * Find top 12 CATI interviewers by response count
 */
async function findTopCATIInterviewers(surveyId, startDate, endDate) {
  console.log('\n📊 Finding top CATI interviewers...');
  console.log(`   Survey ID: ${surveyId}`);
  console.log(`   Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
  
  // Aggregate responses by interviewer
  const interviewerStats = await SurveyResponse.aggregate([
    {
      $match: {
        survey: mongoose.Types.ObjectId.isValid(surveyId) 
          ? new mongoose.Types.ObjectId(surveyId) 
          : surveyId,
        interviewMode: 'cati',
        startTime: {
          $gte: startDate,
          $lte: endDate
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
      $limit: 12
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
      $unwind: {
        path: '$interviewerDetails',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        interviewerId: '$_id',
        memberId: { $ifNull: ['$interviewerDetails.memberId', 'N/A'] },
        firstName: { $ifNull: ['$interviewerDetails.firstName', 'Unknown'] },
        lastName: { $ifNull: ['$interviewerDetails.lastName', ''] },
        responseCount: 1
      }
    }
  ]);
  
  console.log(`✅ Found ${interviewerStats.length} top interviewers`);
  
  return interviewerStats;
}

/**
 * Remove current AC assignments for interviewers
 */
async function removeCurrentACAssignments(surveyId, interviewerIds) {
  console.log('\n🔄 Removing current AC assignments...');
  
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
    console.log('   No CATI interviewers found in survey');
    return;
  }
  
  let removedCount = 0;
  interviewerIds.forEach(interviewerId => {
    const assignment = survey.catiInterviewers.find(
      a => a.interviewer.toString() === interviewerId.toString()
    );
    
    if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
      console.log(`   Removing ACs for interviewer ${interviewerId}: ${assignment.assignedACs.join(', ')}`);
      assignment.assignedACs = [];
      removedCount++;
    }
  });
  
  if (removedCount > 0) {
    await survey.save();
    console.log(`✅ Removed AC assignments from ${removedCount} interviewers`);
  } else {
    console.log('   No AC assignments found to remove');
  }
}

/**
 * Assign AC to interviewer
 */
async function assignACToInterviewer(surveyId, interviewerId, acCode, acMap) {
  const acName = findACName(acCode, acMap);
  
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  // Find or create interviewer assignment
  let assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === interviewerId.toString()
  );
  
  if (!assignment) {
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
  
  // Clear existing ACs and assign new one
  assignment.assignedACs = [acName];
  
  await survey.save();
  
  return {
    interviewerId: interviewerId.toString(),
    acCode: formatACCodeForLookup(acCode),
    acName
  };
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('='.repeat(70));
    console.log('REASSIGN TOP CATI INTERVIEWERS');
    console.log('='.repeat(70));
    
    // Get date range
    const dateRange = getISTDateRange();
    console.log(`\n📅 Date Range (IST):`);
    console.log(`   From: ${dateRange.startDateIST.toISOString()}`);
    console.log(`   To: ${dateRange.endDateIST.toISOString()}`);
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Find top 12 interviewers
    const topInterviewers = await findTopCATIInterviewers(
      DEFAULT_SURVEY_ID,
      dateRange.startDate,
      dateRange.endDate
    );
    
    if (topInterviewers.length === 0) {
      console.log('\n❌ No interviewers found with responses in the date range');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    if (topInterviewers.length < 12) {
      console.log(`\n⚠️  Only found ${topInterviewers.length} interviewers (less than 12)`);
    }
    
    // Display top interviewers
    console.log('\n📊 Top Interviewers:');
    topInterviewers.forEach((interviewer, index) => {
      console.log(`   ${index + 1}. ${interviewer.firstName} ${interviewer.lastName} (Member ID: ${interviewer.memberId}) - ${interviewer.responseCount} responses`);
    });
    
    // Remove current AC assignments
    const interviewerIds = topInterviewers.map(i => i.interviewerId);
    await removeCurrentACAssignments(DEFAULT_SURVEY_ID, interviewerIds);
    
    // Assign ACs (2 interviewers per AC)
    console.log('\n📝 Assigning ACs to interviewers...');
    const assignments = [];
    
    for (let i = 0; i < ACS_TO_ASSIGN.length; i++) {
      const acCode = ACS_TO_ASSIGN[i];
      const interviewer1 = topInterviewers[i * 2];
      const interviewer2 = topInterviewers[i * 2 + 1];
      
      if (interviewer1) {
        const result1 = await assignACToInterviewer(
          DEFAULT_SURVEY_ID,
          interviewer1.interviewerId,
          acCode,
          acMap
        );
        assignments.push({
          interviewer: `${interviewer1.firstName} ${interviewer1.lastName} (${interviewer1.memberId})`,
          ...result1
        });
        console.log(`   ✅ Assigned ${result1.acCode} (${result1.acName}) to ${interviewer1.firstName} ${interviewer1.lastName}`);
      }
      
      if (interviewer2) {
        const result2 = await assignACToInterviewer(
          DEFAULT_SURVEY_ID,
          interviewer2.interviewerId,
          acCode,
          acMap
        );
        assignments.push({
          interviewer: `${interviewer2.firstName} ${interviewer2.lastName} (${interviewer2.memberId})`,
          ...result2
        });
        console.log(`   ✅ Assigned ${result2.acCode} (${result2.acName}) to ${interviewer2.firstName} ${interviewer2.lastName}`);
      }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT SUMMARY');
    console.log('='.repeat(70));
    
    ACS_TO_ASSIGN.forEach(acCode => {
      const acName = findACName(acCode, acMap);
      const assigned = assignments.filter(a => a.acCode === formatACCodeForLookup(acCode));
      console.log(`\n${formatACCodeForLookup(acCode)} - ${acName}:`);
      assigned.forEach(a => {
        console.log(`   - ${a.interviewer}`);
      });
    });
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ Reassignment Complete!');
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

module.exports = { main };

