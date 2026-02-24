#!/usr/bin/env node

/**
 * Reassign all CATI interviewers with AC assignments to 5 specific ACs
 * 
 * This script:
 * 1. Queries the default survey for all CATI interviewers with AC assignments
 * 2. Distributes them evenly across 5 ACs: WB019, WB088, WB171, WB152, WB185
 * 3. Removes existing AC assignments and assigns new ones
 * 
 * Usage: node scripts/reassign_cati_to_5acs.js [surveyId]
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
const ACS_TO_ASSIGN = ['WB019', 'WB088', 'WB171', 'WB152', 'WB185'];

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
 * Get all CATI interviewers with AC assignments from survey
 */
async function getCatiInterviewersWithAC(survey) {
  if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
    return [];
  }

  // Filter interviewers who have AC assignments
  const interviewersWithAC = survey.catiInterviewers.filter(
    assignment => assignment.assignedACs && 
                 Array.isArray(assignment.assignedACs) && 
                 assignment.assignedACs.length > 0
  );

  if (interviewersWithAC.length === 0) {
    return [];
  }

  // Get interviewer details
  const interviewerIds = interviewersWithAC.map(a => a.interviewer);
  const interviewers = await User.find({ _id: { $in: interviewerIds } });

  // Create a map for quick lookup
  const interviewerMap = {};
  interviewers.forEach(interviewer => {
    interviewerMap[interviewer._id.toString()] = interviewer;
  });

  // Prepare results
  const results = interviewersWithAC.map(assignment => {
    const interviewer = interviewerMap[assignment.interviewer.toString()];
    return {
      memberId: interviewer ? interviewer.memberId : 'N/A',
      name: interviewer ? `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() : 'Unknown',
      phone: interviewer ? interviewer.phone : 'N/A',
      email: interviewer ? interviewer.email : 'N/A',
      assignedACs: assignment.assignedACs || [],
      status: assignment.status || 'N/A',
      assignedAt: assignment.assignedAt || 'N/A',
      interviewerId: assignment.interviewer.toString()
    };
  });

  // Sort by memberId for consistent distribution
  results.sort((a, b) => {
    const aId = parseInt(a.memberId) || 0;
    const bId = parseInt(b.memberId) || 0;
    return aId - bId;
  });

  return results;
}

/**
 * Main function
 */
async function main() {
  try {
    const surveyId = process.argv[2] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('REASSIGN ALL CATI INTERVIEWERS TO 5 ACS');
    console.log('='.repeat(70));
    console.log(`Survey ID: ${surveyId}`);
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
    
    // Get all CATI interviewers with AC assignments
    console.log('\n📋 Fetching CATI interviewers with AC assignments...');
    const interviewers = await getCatiInterviewersWithAC(survey);
    console.log(`✅ Found ${interviewers.length} interviewers with AC assignments`);
    
    if (interviewers.length === 0) {
      console.log('\n⚠️  No interviewers with AC assignments found. Nothing to reassign.');
      await mongoose.connection.close();
      process.exit(0);
    }
    
    // Display current assignments
    console.log('\n📊 Current assignments:');
    interviewers.forEach((interviewer, index) => {
      console.log(`  ${index + 1}. ${interviewer.memberId} (${interviewer.name}): ${interviewer.assignedACs.join(', ')}`);
    });
    
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
    
    // Ask for confirmation (in production, you might want to add a --yes flag)
    console.log('\n⚠️  This will remove all existing AC assignments and reassign them.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
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
    const outputDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, `reassign_cati_to_5acs_${Date.now()}.json`);
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

module.exports = { main, assignACToInterviewer, distributeInterviewers, getCatiInterviewersWithAC };
