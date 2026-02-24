#!/usr/bin/env node

/**
 * Assign Single AC to CAPI Interviewer Script
 * 
 * This script assigns a single AC to a CAPI interviewer by member ID
 * 
 * Usage:
 *   node assign_capi_ac_to_interviewer.js <memberId> <acName> [survey_id]
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
  
  // Create a map: acName -> acCode (for verification)
  const acNameMap = {};
  wbACs.forEach(ac => {
    acNameMap[ac.acName] = ac.acCode;
  });
  
  return acNameMap;
}

/**
 * Verify AC name exists
 */
function verifyACName(acName, acNameMap) {
  if (!acNameMap[acName]) {
    throw new Error(`AC name "${acName}" not found in assembly constituencies`);
  }
  return acNameMap[acName];
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
 * Assign AC to CAPI interviewer
 */
async function assignACToCapiInterviewer(surveyId, memberId, acName, acNameMap) {
  console.log(`\n📊 Assigning AC to CAPI interviewer...`);
  
  // Verify AC name exists
  const acCode = verifyACName(acName, acNameMap);
  console.log(`✅ Verified AC: ${acName} (${acCode})`);
  
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
  
  // Initialize capiInterviewers if it doesn't exist
  if (!survey.capiInterviewers) {
    survey.capiInterviewers = [];
  }
  
  // Find or create interviewer assignment in survey
  let assignment = survey.capiInterviewers.find(
    a => a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    // Create new assignment
    assignment = {
      interviewer: user._id,
      assignedBy: user._id,
      assignedAt: new Date(),
      assignedACs: [],
      selectedState: 'West Bengal',
      selectedCountry: 'India',
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    };
    survey.capiInterviewers.push(assignment);
    console.log(`✅ Created new CAPI assignment for interviewer`);
  }
  
  // Check if AC is already assigned
  if (assignment.assignedACs.includes(acName)) {
    console.log(`⚠️  AC "${acName}" is already assigned to this interviewer`);
    return {
      success: true,
      alreadyAssigned: true,
      memberId,
      acName,
      acCode,
      interviewerName: `${user.firstName} ${user.lastName}`
    };
  }
  
  // Store previous ACs for logging
  const previousACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
  
  // CRITICAL: Clear existing ACs before assigning new one (one AC per interviewer)
  if (assignment.assignedACs.length > 0) {
    console.log(`🔄 Removing existing ACs: ${previousACs.join(', ')}`);
    assignment.assignedACs = [];
  }
  
  // Add AC to assignedACs
  assignment.assignedACs.push(acName);
  
  // Update other fields
  assignment.selectedState = 'West Bengal';
  assignment.selectedCountry = 'India';
  assignment.assignedBy = user._id;
  assignment.assignedAt = new Date();
  assignment.status = 'assigned';
  
  // Save survey
  await survey.save();
  console.log(`✅ AC assigned successfully`);
  
  return {
    success: true,
    alreadyAssigned: false,
    memberId,
    acName,
    acCode,
    interviewerId: user._id.toString(),
    interviewerName: `${user.firstName} ${user.lastName}`,
    previousACs
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
      console.error('❌ Error: Member ID and AC name are required');
      console.error('\nUsage: node assign_capi_ac_to_interviewer.js <memberId> <acName> [survey_id]');
      console.error('\nExample:');
      console.error('  node assign_capi_ac_to_interviewer.js 709 Natabari');
      console.error('  node assign_capi_ac_to_interviewer.js 715 Katulpur 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const memberId = args[0];
    const acName = args[1];
    const surveyId = args[2] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('ASSIGN SINGLE AC TO CAPI INTERVIEWER');
    console.log('='.repeat(70));
    console.log(`Member ID: ${memberId}`);
    console.log(`AC Name: ${acName}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acNameMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acNameMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Assign AC
    const result = await assignACToCapiInterviewer(surveyId, memberId, acName, acNameMap);
    
    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT RESULT');
    console.log('='.repeat(70));
    
    if (result.alreadyAssigned) {
      console.log(`⚠️  AC was already assigned`);
    } else {
      console.log(`✅ Successfully assigned AC`);
      if (result.previousACs && result.previousACs.length > 0) {
        console.log(`   Previous ACs: ${result.previousACs.join(', ')}`);
      }
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

module.exports = { main, assignACToCapiInterviewer, loadACJson, verifyACName };
