#!/usr/bin/env node

/**
 * Assign ACs to Top 10 CATI Interviewers Script
 * 
 * This script removes current AC assignments and assigns one of the specified ACs
 * to each of the top 10 CATI interviewers
 * 
 * Usage:
 *   node assign_ac_to_top_10_cati.js
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');
const SurveyResponse = require('../models/SurveyResponse');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

// ACs to assign (one per interviewer)
const ACS_TO_ASSIGN = ['WB154', 'WB087', 'WB190', 'WB021'];

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
 * Get top 10 CATI interviewers (yesterday + today)
 */
async function getTop10CATIInterviewers() {
  // Calculate yesterday and today dates in IST
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  
  const todayIST = new Date(istTime);
  todayIST.setUTCHours(0, 0, 0, 0);
  const todayYear = todayIST.getUTCFullYear();
  const todayMonth = todayIST.getUTCMonth();
  const todayDay = todayIST.getUTCDate();
  
  const yesterdayIST = new Date(todayIST);
  yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
  const yesterdayYear = yesterdayIST.getUTCFullYear();
  const yesterdayMonth = yesterdayIST.getUTCMonth();
  const yesterdayDay = yesterdayIST.getUTCDate();
  
  const yesterdayStartUTC = new Date(Date.UTC(yesterdayYear, yesterdayMonth, yesterdayDay, 18, 30, 0, 0));
  yesterdayStartUTC.setUTCDate(yesterdayStartUTC.getUTCDate() - 1);
  
  const todayEndUTC = new Date(Date.UTC(todayYear, todayMonth, todayDay, 18, 29, 59, 999));
  
  const pipeline = [
    {
      $match: {
        survey: mongoose.Types.ObjectId.isValid(DEFAULT_SURVEY_ID) 
          ? new mongoose.Types.ObjectId(DEFAULT_SURVEY_ID) 
          : DEFAULT_SURVEY_ID,
        interviewMode: 'cati',
        startTime: {
          $gte: yesterdayStartUTC,
          $lte: todayEndUTC
        },
        interviewer: { $exists: true, $ne: null }
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
      $limit: 10
    }
  ];

  const results = await SurveyResponse.aggregate(pipeline);
  
  // Populate interviewer details
  const interviewerIds = results.map(r => r._id).filter(id => id);
  const interviewers = await User.find({ _id: { $in: interviewerIds } })
    .select('firstName lastName name memberId email userType')
    .lean();

  const interviewerMap = {};
  interviewers.forEach(interviewer => {
    interviewerMap[interviewer._id.toString()] = interviewer;
  });

  return results.map(result => {
    const interviewer = interviewerMap[result._id?.toString()] || null;
    return {
      interviewerId: result._id,
      memberId: interviewer?.memberId || result._id.toString(),
      name: interviewer?.firstName && interviewer?.lastName
        ? `${interviewer.firstName} ${interviewer.lastName}`.trim()
        : interviewer?.name || interviewer?.email || interviewer?.memberId || 'Unknown',
      responseCount: result.responseCount
    };
  });
}

/**
 * Assign AC to interviewer
 */
async function assignACToInterviewer(survey, memberId, acCode, acMap) {
  const acName = findACName(acCode, acMap);
  
  // Find user by memberId
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    throw new Error(`Interviewer with member ID ${memberId} not found`);
  }
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  // Find or create interviewer assignment in survey
  let assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    // Create new assignment
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
  
  // Clear existing ACs before assigning new one
  const previousACs = assignment.assignedACs.length > 0 ? [...assignment.assignedACs] : [];
  assignment.assignedACs = [];
  
  // Add AC to assignedACs
  assignment.assignedACs.push(acName);
  
  return {
    memberId,
    acCode: formatACCodeForLookup(acCode),
    acName,
    interviewerName: `${user.firstName} ${user.lastName}`,
    previousACs
  };
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('='.repeat(70));
    console.log('ASSIGN ACs TO TOP 10 CATI INTERVIEWERS');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${DEFAULT_SURVEY_ID}`);
    console.log(`ACs to assign: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Get top 10 interviewers
    console.log('\n📊 Getting top 10 CATI interviewers (yesterday + today)...');
    const top10Interviewers = await getTop10CATIInterviewers();
    console.log(`✅ Found ${top10Interviewers.length} interviewers\n`);
    
    // Display top 10
    console.log('Top 10 CATI Interviewers:');
    top10Interviewers.forEach((interviewer, index) => {
      console.log(`  ${index + 1}. ${interviewer.name} (${interviewer.memberId}) - ${interviewer.responseCount} responses`);
    });
    
    // Load survey
    console.log('\n📋 Loading survey...');
    const survey = await Survey.findById(DEFAULT_SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${DEFAULT_SURVEY_ID} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName}`);
    
    // Distribute ACs to interviewers (round-robin)
    console.log('\n🔄 Assigning ACs to interviewers...');
    console.log('─'.repeat(70));
    
    const results = [];
    const acUsage = {}; // Track how many times each AC is used
    
    for (let i = 0; i < top10Interviewers.length; i++) {
      const interviewer = top10Interviewers[i];
      // Round-robin assignment: WB154, WB087, WB190, WB021, WB154, WB087, WB190, WB021, WB154, WB087
      const acCode = ACS_TO_ASSIGN[i % ACS_TO_ASSIGN.length];
      
      try {
        const result = await assignACToInterviewer(survey, interviewer.memberId, acCode, acMap);
        results.push({
          ...result,
          success: true,
          error: null
        });
        
        // Track AC usage
        acUsage[acCode] = (acUsage[acCode] || 0) + 1;
        
        console.log(`✅ [${i + 1}/10] ${interviewer.name} (${interviewer.memberId})`);
        if (result.previousACs.length > 0) {
          console.log(`   Removed: ${result.previousACs.join(', ')}`);
        }
        console.log(`   Assigned: ${result.acName} (${result.acCode})`);
      } catch (error) {
        results.push({
          memberId: interviewer.memberId,
          interviewerName: interviewer.name,
          success: false,
          error: error.message
        });
        console.log(`❌ [${i + 1}/10] ${interviewer.name} (${interviewer.memberId})`);
        console.log(`   Error: ${error.message}`);
      }
    }
    
    // Save survey
    console.log('\n💾 Saving survey...');
    await survey.save();
    console.log('✅ Survey saved successfully');
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT SUMMARY');
    console.log('='.repeat(70));
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\n✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    
    console.log('\n📊 AC Distribution:');
    Object.entries(acUsage).forEach(([acCode, count]) => {
      const acName = findACName(acCode, acMap);
      console.log(`   ${acCode} (${acName}): ${count} interviewer(s)`);
    });
    
    console.log('\n📋 Detailed Results:');
    results.forEach((result, index) => {
      if (result.success) {
        console.log(`\n${index + 1}. ${result.interviewerName} (${result.memberId})`);
        console.log(`   ✅ Assigned: ${result.acName} (${result.acCode})`);
        if (result.previousACs && result.previousACs.length > 0) {
          console.log(`   🔄 Removed: ${result.previousACs.join(', ')}`);
        }
      } else {
        console.log(`\n${index + 1}. ${result.interviewerName || 'Unknown'} (${result.memberId})`);
        console.log(`   ❌ Error: ${result.error}`);
      }
    });
    
    console.log('\n' + '='.repeat(70));
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(failed > 0 ? 1 : 0);
    
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












