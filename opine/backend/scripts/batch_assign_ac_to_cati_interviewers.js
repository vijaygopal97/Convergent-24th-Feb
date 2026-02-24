#!/usr/bin/env node

/**
 * Batch Assign ACs to CATI Interviewers Script
 * 
 * This script assigns ACs to multiple CATI interviewers in batch
 * Removes existing AC assignments before assigning new ones
 * 
 * Usage:
 *   node batch_assign_ac_to_cati_interviewers.js [survey_id]
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
  // Convert acCode to string if it's a number
  const acCodeStr = String(acCode);
  
  // Find AC name
  const acName = findACName(acCodeStr, acMap);
  const formattedACCode = formatACCodeForLookup(acCodeStr);
  
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
  
  // CRITICAL: Clear existing ACs before assigning new one (one AC per interviewer)
  const previousACs = assignment.assignedACs.length > 0 ? [...assignment.assignedACs] : [];
  assignment.assignedACs = [acName];
  
  // Save survey
  await survey.save();
  
  return {
    success: true,
    memberId,
    acCode: formattedACCode,
    acName,
    interviewerName: `${user.firstName} ${user.lastName}`,
    previousACs,
    hadPreviousAssignment: previousACs.length > 0
  };
}

/**
 * Main function
 */
async function main() {
  try {
    const args = process.argv.slice(2);
    const surveyId = args[0] || DEFAULT_SURVEY_ID;
    
    // Assignment data from image
    const assignments = [
      { acCode: 241, memberId: 666 },
      { acCode: 224, memberId: 670 },
      { acCode: 222, memberId: 8322 },
      { acCode: 242, memberId: 672 },
      { acCode: 203, memberId: 8008 },
      { acCode: 255, memberId: 12735 },
      { acCode: 251, memberId: 10018 },
      { acCode: 145, memberId: 8003 },
      { acCode: 195, memberId: 8007 },
      { acCode: 187, memberId: 8010 },
      { acCode: 155, memberId: 8009 },
      { acCode: 14, memberId: 10031 },
      { acCode: 11, memberId: 8302 },
      { acCode: 8, memberId: 8300 },
      { acCode: 22, memberId: 10003 },
      { acCode: 23, memberId: 8301 }
    ];
    
    console.log('='.repeat(70));
    console.log('BATCH ASSIGN ACs TO CATI INTERVIEWERS');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
    console.log(`Total Assignments: ${assignments.length}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };
    
    // Process each assignment
    console.log('\n📋 Processing assignments...\n');
    
    for (let i = 0; i < assignments.length; i++) {
      const { acCode, memberId } = assignments[i];
      
      try {
        console.log(`[${i + 1}/${assignments.length}] Processing: Member ID ${memberId} → AC ${acCode}`);
        
        const result = await assignACToInterviewer(surveyId, memberId, acCode, acMap);
        
        if (result.hadPreviousAssignment) {
          console.log(`   ✅ Assigned: ${result.acName} (${result.acCode})`);
          console.log(`   🔄 Removed previous ACs: ${result.previousACs.join(', ')}`);
        } else {
          console.log(`   ✅ Assigned: ${result.acName} (${result.acCode})`);
        }
        
        results.successful.push({
          memberId,
          acCode: result.acCode,
          acName: result.acName,
          interviewerName: result.interviewerName,
          previousACs: result.previousACs
        });
        
      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        results.failed.push({
          memberId,
          acCode,
          error: error.message
        });
      }
      
      console.log('');
    }
    
    // Print summary
    console.log('='.repeat(70));
    console.log('BATCH ASSIGNMENT SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`⏭️  Skipped: ${results.skipped.length}`);
    console.log('='.repeat(70));
    
    if (results.successful.length > 0) {
      console.log('\n✅ Successfully Assigned:');
      results.successful.forEach((r, i) => {
        console.log(`   ${i + 1}. ${r.interviewerName} (${r.memberId}) → ${r.acName} (${r.acCode})`);
        if (r.previousACs.length > 0) {
          console.log(`      Removed: ${r.previousACs.join(', ')}`);
        }
      });
    }
    
    if (results.failed.length > 0) {
      console.log('\n❌ Failed Assignments:');
      results.failed.forEach((r, i) => {
        console.log(`   ${i + 1}. Member ID ${r.memberId} → AC ${r.acCode}: ${r.error}`);
      });
    }
    
    console.log('\n' + '='.repeat(70));
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(results.failed.length > 0 ? 1 : 0);
    
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

