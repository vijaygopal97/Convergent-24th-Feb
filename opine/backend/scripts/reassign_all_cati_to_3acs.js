#!/usr/bin/env node

/**
 * Reassign all CATI interviewers with AC assignments to 3 specific ACs
 * 
 * This script:
 * 1. Reads the list of CATI interviewers with AC assignments
 * 2. Distributes them evenly across 3 ACs: WB168, WB160, WB190
 * 3. Removes existing AC assignments and assigns new ones
 * 
 * Usage: node scripts/reassign_all_cati_to_3acs.js [surveyId] [jsonFile]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Survey = require('../models/Survey');
const User = require('../models/User');

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

// ACs to assign
const ACS_TO_ASSIGN = ['WB168', 'WB160', 'WB190'];

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
 * Format AC code for JSON lookup
 */
function formatACCodeForLookup(acCode) {
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
 * Assign AC to interviewer
 */
async function assignACToInterviewer(survey, memberId, acCode, acMap) {
  // Find AC name
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
  
  // Store previous ACs for logging
  const previousACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
  
  // Clear existing ACs and assign new one
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

/**
 * Distribute interviewers evenly across ACs
 */
function distributeInterviewers(interviewers, acs) {
  const distribution = [];
  const acCount = acs.length;
  
  interviewers.forEach((interviewer, index) => {
    const acIndex = index % acCount;
    distribution.push({
      interviewer,
      acCode: acs[acIndex]
    });
  });
  
  return distribution;
}

/**
 * Main function
 */
async function main() {
  try {
    const surveyId = process.argv[2] || DEFAULT_SURVEY_ID;
    const jsonFile = process.argv[3] || path.join(__dirname, '../reports/cati_interviewers_with_ac_1771569170571.json');
    
    console.log('='.repeat(70));
    console.log('REASSIGN ALL CATI INTERVIEWERS TO 3 ACS');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
    console.log(`JSON File: ${jsonFile}`);
    console.log(`ACs to assign: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Verify ACs exist
    console.log('\n🔍 Verifying ACs...');
    ACS_TO_ASSIGN.forEach(acCode => {
      const acName = findACName(acCode, acMap);
      console.log(`  ✅ ${acCode}: ${acName}`);
    });
    
    // Load interviewers from JSON
    console.log(`\n📖 Loading interviewers from JSON file...`);
    if (!fs.existsSync(jsonFile)) {
      throw new Error(`JSON file not found: ${jsonFile}`);
    }
    
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const interviewers = data.interviewers || [];
    
    console.log(`✅ Loaded ${interviewers.length} interviewers`);
    
    if (interviewers.length === 0) {
      throw new Error('No interviewers found in JSON file');
    }
    
    // Distribute interviewers across ACs
    console.log(`\n📊 Distributing ${interviewers.length} interviewers across ${ACS_TO_ASSIGN.length} ACs...`);
    const distribution = distributeInterviewers(interviewers, ACS_TO_ASSIGN);
    
    // Count distribution
    const acCounts = {};
    ACS_TO_ASSIGN.forEach(ac => acCounts[ac] = 0);
    distribution.forEach(d => acCounts[d.acCode]++);
    
    console.log('\n📋 Distribution plan:');
    ACS_TO_ASSIGN.forEach(acCode => {
      const acName = findACName(acCode, acMap);
      console.log(`  ${acCode} (${acName}): ${acCounts[acCode]} interviewers`);
    });
    
    // Connect to MongoDB
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Load survey
    console.log('\n📖 Loading survey...');
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName}`);
    
    // Process each interviewer
    console.log('\n' + '='.repeat(70));
    console.log('PROCESSING ASSIGNMENTS');
    console.log('='.repeat(70));
    
    const results = {
      successful: [],
      failed: [],
      skipped: []
    };
    
    for (let i = 0; i < distribution.length; i++) {
      const { interviewer, acCode } = distribution[i];
      const progress = `[${i + 1}/${distribution.length}]`;
      
      try {
        console.log(`\n${progress} Processing: ${interviewer.memberId} - ${interviewer.name}`);
        console.log(`  Current AC: ${interviewer.assignedACs.join(', ')}`);
        console.log(`  New AC: ${acCode} (${findACName(acCode, acMap)})`);
        
        const result = await assignACToInterviewer(survey, interviewer.memberId, acCode, acMap);
        
        // Save survey after each assignment
        await survey.save();
        
        results.successful.push({
          ...result,
          previousACs: interviewer.assignedACs
        });
        
        console.log(`  ✅ Successfully assigned ${result.acName}`);
        
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        results.failed.push({
          memberId: interviewer.memberId,
          name: interviewer.name,
          acCode,
          error: error.message
        });
      }
    }
    
    // Print summary
    console.log('\n\n' + '='.repeat(70));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(70));
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`⏭️  Skipped: ${results.skipped.length}`);
    
    if (results.successful.length > 0) {
      console.log('\n✅ Successfully reassigned interviewers:');
      const acSummary = {};
      ACS_TO_ASSIGN.forEach(ac => acSummary[ac] = 0);
      results.successful.forEach(r => {
        acSummary[r.acCode]++;
      });
      ACS_TO_ASSIGN.forEach(acCode => {
        const acName = findACName(acCode, acMap);
        console.log(`  ${acCode} (${acName}): ${acSummary[acCode]} interviewers`);
      });
    }
    
    if (results.failed.length > 0) {
      console.log('\n❌ Failed assignments:');
      results.failed.forEach(f => {
        console.log(`  ${f.memberId} (${f.name}): ${f.error}`);
      });
    }
    
    // Save results to JSON
    const outputPath = path.join(__dirname, '../reports/reassign_cati_to_3acs_' + Date.now() + '.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      surveyId,
      surveyName: survey.surveyName,
      generatedAt: new Date().toISOString(),
      acsAssigned: ACS_TO_ASSIGN,
      totalProcessed: distribution.length,
      successful: results.successful.length,
      failed: results.failed.length,
      skipped: results.skipped.length,
      results: {
        successful: results.successful,
        failed: results.failed,
        skipped: results.skipped
      }
    }, null, 2));
    
    console.log(`\n💾 Results saved to: ${outputPath}`);
    console.log('='.repeat(70));
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(results.failed.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, assignACToInterviewer, distributeInterviewers };








