#!/usr/bin/env node

/**
 * Assign Single AC to Interviewer Script
 * 
 * This script assigns a single AC to an interviewer by member ID
 * 
 * Usage:
 *   node assign_single_ac_to_interviewer.js <memberId> <acCode> [survey_id]
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
 * Assign AC to interviewer
 */
async function assignACToInterviewer(surveyId, memberId, acCode, acMap) {
  console.log(`\n📊 Assigning AC to interviewer...`);
  
  // Find AC name
  const acName = findACName(acCode, acMap);
  console.log(`✅ Found AC: ${acName} (${formatACCodeForLookup(acCode)})`);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  
  // Find user by memberId
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    throw new Error(`Interviewer with member ID ${memberId} not found`);
  }
  
  console.log(`✅ Found interviewer: ${user.firstName} ${user.lastName} (${user.memberId})`);
  
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
    console.log(`✅ Created new assignment for interviewer`);
  }
  
  // Check if AC is already assigned
  if (assignment.assignedACs.includes(acName)) {
    console.log(`⚠️  AC "${acName}" is already assigned to this interviewer`);
    return {
      success: true,
      alreadyAssigned: true,
      memberId,
      acCode: formatACCodeForLookup(acCode),
      acName,
      interviewerName: `${user.firstName} ${user.lastName}`
    };
  }
  
  // CRITICAL: Clear existing ACs before assigning new one (one AC per interviewer)
  // This ensures only one AC is assigned at a time
  if (assignment.assignedACs.length > 0) {
    console.log(`🔄 Removing existing ACs: ${assignment.assignedACs.join(', ')}`);
    assignment.assignedACs = [];
  }
  
  // Add AC to assignedACs
  assignment.assignedACs.push(acName);
  
  // Save survey
  await survey.save();
  console.log(`✅ AC assigned successfully`);
  
  return {
    success: true,
    alreadyAssigned: false,
    memberId,
    acCode: formatACCodeForLookup(acCode),
    acName,
    interviewerId: user._id.toString(),
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
    
    if (args.length < 2) {
      console.error('❌ Error: Member ID and AC code are required');
      console.error('\nUsage: node assign_single_ac_to_interviewer.js <memberId> <acCode> [survey_id]');
      console.error('\nExample:');
      console.error('  node assign_single_ac_to_interviewer.js 1007 WB251');
      console.error('  node assign_single_ac_to_interviewer.js 1007 251');
      console.error('  node assign_single_ac_to_interviewer.js 1007 WB251 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const memberId = args[0];
    const acCode = args[1];
    const surveyId = args[2] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('ASSIGN SINGLE AC TO INTERVIEWER');
    console.log('='.repeat(70));
    console.log(`Member ID: ${memberId}`);
    console.log(`AC Code: ${acCode}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Assign AC
    const result = await assignACToInterviewer(surveyId, memberId, acCode, acMap);
    
    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT RESULT');
    console.log('='.repeat(70));
    
    if (result.alreadyAssigned) {
      console.log(`⚠️  AC was already assigned`);
    } else {
      console.log(`✅ Successfully assigned AC`);
    }
    
    console.log(`  - Interviewer: ${result.interviewerName} (${result.memberId})`);
    console.log(`  - AC: ${result.acName} (${result.acCode})`);
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

module.exports = { main, assignACToInterviewer, loadACJson, formatACCodeForLookup, findACName };








