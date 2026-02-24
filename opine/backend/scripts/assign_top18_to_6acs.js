#!/usr/bin/env node

/**
 * Assign Top 18 CATI Interviewers to 6 ACs
 * 
 * This script:
 * 1. Removes existing AC assignments for top 18 interviewers
 * 2. Assigns them to 6 AC codes (3 interviewers per AC)
 * 
 * Usage:
 *   node assign_top18_to_6acs.js <ac1> <ac2> <ac3> <ac4> <ac5> <ac6> [survey_id]
 * 
 * Example:
 *   node assign_top18_to_6acs.js WB242 WB243 WB244 WB245 WB246 WB247
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

// Top 18 interviewers from the list (Member IDs)
const TOP_18_MEMBER_IDS = [
  '8301',  // Swati Shaw
  '8304',  // Sanjana Shaw
  '3804',  // Suman Adak
  '8322',  // Barnali Debnath
  '191',   // Sumit Kumar Roy
  '8302',  // Tanu kumari Singh
  '272',   // Deepshikha Das
  '277',   // Disha Mayur
  '236',   // Avi Mondal
  '8303',  // Sahana Anjoom
  '276',   // Sayan Das
  '10003', // SEULI KHATUN
  '8300',  // Bishakha Tanti
  '3806',  // Sarmistha das
  '10018', // Rehena Sultana
  '185',   // MD. Ehtasam
  '825',   // Manika Sarkar
  '8003'   // Kakali Mondal
];

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
 * Remove existing AC assignments for interviewers
 */
async function removeExistingAssignments(surveyId, memberIds) {
  console.log(`\n🗑️  Removing existing AC assignments for ${memberIds.length} interviewers...`);
  
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
    console.log('✅ No existing assignments found');
    return { removed: 0, notFound: [] };
  }
  
  const results = {
    removed: 0,
    notFound: []
  };
  
  // Find users by memberId
  const users = await User.find({ memberId: { $in: memberIds } });
  const userIdMap = {};
  users.forEach(user => {
    userIdMap[user.memberId] = user._id.toString();
  });
  
  // Remove assignments
  for (const memberId of memberIds) {
    const userId = userIdMap[memberId];
    if (!userId) {
      results.notFound.push(memberId);
      continue;
    }
    
    const assignment = survey.catiInterviewers.find(
      a => a.interviewer && a.interviewer.toString() === userId
    );
    
    if (assignment && assignment.assignedACs && assignment.assignedACs.length > 0) {
      const previousACs = [...assignment.assignedACs];
      assignment.assignedACs = [];
      results.removed++;
      console.log(`   ✅ Removed ACs for Member ID ${memberId}: ${previousACs.join(', ')}`);
    } else {
      console.log(`   ℹ️  No existing ACs for Member ID ${memberId}`);
    }
  }
  
  await survey.save();
  console.log(`\n✅ Removed assignments for ${results.removed} interviewers`);
  if (results.notFound.length > 0) {
    console.log(`⚠️  Could not find ${results.notFound.length} interviewers: ${results.notFound.join(', ')}`);
  }
  
  return results;
}

/**
 * Assign AC to interviewer
 */
async function assignACToInterviewer(surveyId, memberId, acCode, acMap) {
  // Find AC name
  const acName = findACName(acCode, acMap);
  const formattedACCode = formatACCodeForLookup(acCode);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
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
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
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
  
  // Clear existing ACs and assign new one
  assignment.assignedACs = [acName];
  
  // Save survey
  await survey.save();
  
  return {
    success: true,
    memberId,
    acCode: formattedACCode,
    acName,
    interviewerName: `${user.firstName} ${user.lastName}`
  };
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 6) {
      console.error('❌ Error: 6 AC codes are required');
      console.error('\nUsage: node assign_top18_to_6acs.js <ac1> <ac2> <ac3> <ac4> <ac5> <ac6> [survey_id]');
      console.error('\nExample:');
      console.error('  node assign_top18_to_6acs.js WB242 WB243 WB244 WB245 WB246 WB247');
      console.error('  node assign_top18_to_6acs.js 242 243 244 245 246 247');
      process.exit(1);
    }
    
    const acCodes = args.slice(0, 6);
    const surveyId = args[6] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('ASSIGN TOP 18 CATI INTERVIEWERS TO 6 ACs');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
    console.log(`AC Codes: ${acCodes.join(', ')}`);
    console.log(`Interviewers: ${TOP_18_MEMBER_IDS.length} (3 per AC)`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Validate AC codes
    console.log('\n🔍 Validating AC codes...');
    const acNames = [];
    for (const acCode of acCodes) {
      try {
        const acName = findACName(acCode, acMap);
        const formattedCode = formatACCodeForLookup(acCode);
        acNames.push(acName);
        console.log(`   ✅ ${formattedCode}: ${acName}`);
      } catch (error) {
        console.error(`   ❌ ${acCode}: ${error.message}`);
        throw error;
      }
    }
    
    // Connect to database
    await connectDB();
    
    // Step 1: Remove existing assignments
    console.log('\n' + '='.repeat(70));
    console.log('STEP 1: REMOVING EXISTING ASSIGNMENTS');
    console.log('='.repeat(70));
    await removeExistingAssignments(surveyId, TOP_18_MEMBER_IDS);
    
    // Step 2: Assign ACs (3 interviewers per AC)
    console.log('\n' + '='.repeat(70));
    console.log('STEP 2: ASSIGNING ACs TO INTERVIEWERS');
    console.log('='.repeat(70));
    
    const assignments = [];
    let interviewerIndex = 0;
    
    for (let acIndex = 0; acIndex < 6; acIndex++) {
      const acCode = acCodes[acIndex];
      const acName = acNames[acIndex];
      const formattedACCode = formatACCodeForLookup(acCode);
      
      console.log(`\n📋 Assigning AC ${formattedACCode} (${acName}) to 3 interviewers:`);
      
      // Assign 3 interviewers to this AC
      for (let i = 0; i < 3; i++) {
        const memberId = TOP_18_MEMBER_IDS[interviewerIndex];
        try {
          const result = await assignACToInterviewer(surveyId, memberId, acCode, acMap);
          assignments.push(result);
          console.log(`   ✅ ${i + 1}. ${result.interviewerName} (Member ID: ${memberId})`);
          interviewerIndex++;
        } catch (error) {
          console.error(`   ❌ ${i + 1}. Member ID ${memberId}: ${error.message}`);
          interviewerIndex++;
        }
      }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT SUMMARY');
    console.log('='.repeat(70));
    
    // Group by AC
    const acGroups = {};
    acCodes.forEach((acCode, index) => {
      const formattedCode = formatACCodeForLookup(acCode);
      acGroups[formattedCode] = {
        acName: acNames[index],
        interviewers: []
      };
    });
    
    assignments.forEach(assignment => {
      acGroups[assignment.acCode].interviewers.push(assignment);
    });
    
    Object.keys(acGroups).forEach(acCode => {
      const group = acGroups[acCode];
      console.log(`\n${acCode}: ${group.acName}`);
      group.interviewers.forEach((interviewer, index) => {
        console.log(`   ${index + 1}. ${interviewer.interviewerName} (Member ID: ${interviewer.memberId})`);
      });
    });
    
    console.log('\n' + '='.repeat(70));
    console.log(`✅ Successfully assigned ${assignments.length} interviewers to 6 ACs`);
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

module.exports = { main, assignACToInterviewer, removeExistingAssignments, loadACJson, formatACCodeForLookup, findACName };






























