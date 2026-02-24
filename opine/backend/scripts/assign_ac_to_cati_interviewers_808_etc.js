#!/usr/bin/env node

/**
 * Assign ACs to CATI Interviewers Script
 * 
 * This script assigns ACs to CATI interviewers by member ID (for CATI assignments only)
 * 
 * Usage:
 *   node assign_ac_to_cati_interviewers_808_etc.js
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

// Member IDs to assign (CATI interviewers)
const MEMBER_IDS = ['808', '3804', '3803', '198', '236', '226', '191', '8302'];

// AC codes to assign (will be distributed evenly)
const AC_CODES = ['WB168', 'WB160', 'WB190'];

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
 * Assign AC to CATI interviewer (CATI assignment only)
 */
async function assignACToCATIInterviewer(surveyId, memberId, acCode, acMap, assignedByUserId) {
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
  
  // Find or create CATI interviewer assignment in survey
  let assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    // Create new CATI assignment
    assignment = {
      interviewer: user._id,
      assignedBy: assignedByUserId || user._id,
      assignedAt: new Date(),
      assignedACs: [],
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    };
    survey.catiInterviewers.push(assignment);
    console.log(`✅ Created new CATI assignment for interviewer ${memberId}`);
  }
  
  // Check if AC is already assigned
  if (assignment.assignedACs.includes(acName)) {
    console.log(`⚠️  AC "${acName}" is already assigned to CATI interviewer ${memberId}`);
    return {
      success: true,
      alreadyAssigned: true,
      memberId,
      acCode: formattedACCode,
      acName,
      interviewerName: `${user.firstName} ${user.lastName}`
    };
  }
  
  // CRITICAL: Clear existing ACs before assigning new one (one AC per interviewer)
  if (assignment.assignedACs.length > 0) {
    console.log(`🔄 Removing existing ACs: ${assignment.assignedACs.join(', ')}`);
  }
  
  // Directly assign the AC array (Mongoose needs direct assignment for subdocuments)
  assignment.assignedACs = [acName];
  
  // Mark the array as modified for Mongoose
  survey.markModified('catiInterviewers');
  
  // Update assignment metadata
  assignment.assignedBy = assignedByUserId || assignment.assignedBy;
  assignment.assignedAt = new Date();
  assignment.status = 'assigned';
  
  // Save survey
  await survey.save();
  console.log(`✅ AC "${acName}" assigned successfully to CATI interviewer ${memberId}`);
  
  return {
    success: true,
    alreadyAssigned: false,
    memberId,
    acCode: formattedACCode,
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
    const surveyId = DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('ASSIGN ACs TO CATI INTERVIEWERS (CATI ASSIGNMENTS ONLY)');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
    console.log(`Member IDs: ${MEMBER_IDS.join(', ')}`);
    console.log(`AC Codes: ${AC_CODES.join(', ')}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Get a system user for assignedBy (or use first admin)
    const adminUser = await User.findOne({ userType: 'admin' }).select('_id').lean();
    const assignedByUserId = adminUser?._id || null;
    
    // Distribute ACs evenly across interviewers
    const results = [];
    for (let i = 0; i < MEMBER_IDS.length; i++) {
      const memberId = MEMBER_IDS[i];
      const acCode = AC_CODES[i % AC_CODES.length]; // Round-robin distribution
      
      console.log(`\n📊 Processing CATI interviewer ${i + 1}/${MEMBER_IDS.length}: Member ID ${memberId}`);
      console.log(`   Assigning AC: ${acCode}`);
      
      try {
        const result = await assignACToCATIInterviewer(surveyId, memberId, acCode, acMap, assignedByUserId);
        results.push(result);
      } catch (error) {
        console.error(`❌ Error assigning AC to ${memberId}:`, error.message);
        results.push({
          success: false,
          memberId,
          error: error.message
        });
      }
    }
    
    // Print results summary
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT RESULTS SUMMARY');
    console.log('='.repeat(70));
    
    const successful = results.filter(r => r.success && !r.alreadyAssigned);
    const alreadyAssigned = results.filter(r => r.success && r.alreadyAssigned);
    const failed = results.filter(r => !r.success);
    
    console.log(`\n✅ Successfully assigned: ${successful.length}`);
    successful.forEach(r => {
      console.log(`   - ${r.interviewerName} (${r.memberId}) → ${r.acName} (${r.acCode})`);
    });
    
    if (alreadyAssigned.length > 0) {
      console.log(`\n⚠️  Already assigned: ${alreadyAssigned.length}`);
      alreadyAssigned.forEach(r => {
        console.log(`   - ${r.interviewerName} (${r.memberId}) → ${r.acName} (${r.acCode})`);
      });
    }
    
    if (failed.length > 0) {
      console.log(`\n❌ Failed: ${failed.length}`);
      failed.forEach(r => {
        console.log(`   - Member ID ${r.memberId}: ${r.error}`);
      });
    }
    
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

module.exports = { main, assignACToCATIInterviewer, loadACJson, formatACCodeForLookup, findACName };
