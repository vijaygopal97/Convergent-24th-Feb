#!/usr/bin/env node

/**
 * Assign ACs to CATI Interviewers Script
 * 
 * This script reads an Excel file with interviewer memberIDs and AC codes,
 * converts AC codes to AC names, and assigns them to the respective interviewers
 * in the survey's catiInterviewers array.
 * 
 * Usage:
 *   node assign_acs_to_cati_interviewers.js <excel_file> <survey_id> [assigned_by_user_id]
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Change to backend directory to load modules
process.chdir('/var/www/opine/backend');

const Survey = require('./models/Survey');
const User = require('./models/User');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json';

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
 * Format AC code for JSON lookup (e.g., 292 -> WB292, 3 -> WB003)
 */
function formatACCodeForLookup(acCode) {
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
    throw new Error(`AC name not found for code: ${lookupCode} (from AC code ${acCode})`);
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
 * Read Excel file and extract interviewer-AC mappings using Python
 */
function readExcelFile(excelPath) {
  console.log(`\n📖 Reading Excel file: ${excelPath}`);
  
  // Use Python to read Excel file
  const pythonScript = `
import pandas as pd
import json
import sys

excel_path = sys.argv[1]

# Read Excel file
df = pd.read_excel(excel_path)

# Convert to JSON
data = df.to_dict('records')

# Output as JSON
print(json.dumps(data))
`;
  
  try {
    const output = execSync(`python3 -c ${JSON.stringify(pythonScript)} "${excelPath}"`, { 
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    const data = JSON.parse(output.trim());
    
    console.log(`✅ Loaded ${data.length} rows from Excel`);
    
    // Extract mappings
    const mappings = [];
    const errors = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // +2 for header and 0-index
      
      const interviewerId = row['Interviewer ID'] || row['interviewer ID'] || row['InterviewerID'];
      const acCode = row['AC'] || row['ac'] || row['Ac'];
      
      if (!interviewerId && interviewerId !== 0) {
        errors.push(`Row ${rowNum}: Missing Interviewer ID`);
        continue;
      }
      
      if (!acCode && acCode !== 0 && acCode !== '0') {
        errors.push(`Row ${rowNum}: Missing AC code`);
        continue;
      }
      
      mappings.push({
        memberId: String(interviewerId).trim(),
        acCode: String(acCode).trim(),
        interviewerName: row['Interviewer'] || row['interviewer'] || 'Unknown',
        rowNum
      });
    }
    
    if (errors.length > 0) {
      console.log(`\n⚠️  ${errors.length} errors found:`);
      errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
      if (errors.length > 10) {
        console.log(`  ... and ${errors.length - 10} more errors`);
      }
    }
    
    console.log(`✅ Extracted ${mappings.length} valid interviewer-AC mappings`);
    
    return { mappings, errors };
  } catch (error) {
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
}

/**
 * Process and assign ACs to interviewers
 */
async function assignACsToInterviewers(surveyId, mappings, acMap, assignedByUserId) {
  console.log(`\n📊 Processing ${mappings.length} interviewer-AC assignments...`);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  const results = {
    successful: [],
    failed: [],
    notFound: [],
    alreadyAssigned: []
  };
  
  // Process each mapping
  for (const mapping of mappings) {
    try {
      const { memberId, acCode, interviewerName, rowNum } = mapping;
      
      // Find AC name
      let acName;
      try {
        acName = findACName(acCode, acMap);
      } catch (error) {
        results.failed.push({
          memberId,
          acCode,
          interviewerName,
          error: error.message,
          rowNum
        });
        continue;
      }
      
      // Find user by memberId
      const user = await User.findOne({ memberId: memberId });
      if (!user) {
        results.notFound.push({
          memberId,
          acCode,
          acName,
          interviewerName,
          rowNum
        });
        continue;
      }
      
      // Find or create interviewer assignment in survey
      let assignment = survey.catiInterviewers.find(
        a => a.interviewer.toString() === user._id.toString()
      );
      
      if (!assignment) {
        // Create new assignment
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
      }
      
      // Check if AC is already assigned
      if (assignment.assignedACs.includes(acName)) {
        results.alreadyAssigned.push({
          memberId,
          acCode,
          acName,
          interviewerName: `${user.firstName} ${user.lastName}`,
          rowNum
        });
        continue;
      }
      
      // Add AC to assignedACs
      assignment.assignedACs.push(acName);
      
      results.successful.push({
        memberId,
        acCode,
        acCodeFormatted: formatACCodeForLookup(acCode),
        acName,
        interviewerId: user._id.toString(),
        interviewerName: `${user.firstName} ${user.lastName}`,
        rowNum
      });
      
    } catch (error) {
      results.failed.push({
        memberId: mapping.memberId,
        acCode: mapping.acCode,
        interviewerName: mapping.interviewerName,
        error: error.message,
        rowNum: mapping.rowNum
      });
    }
  }
  
  // Save survey
  if (results.successful.length > 0 || results.alreadyAssigned.length > 0) {
    await survey.save();
    console.log(`✅ Survey updated successfully`);
  }
  
  return results;
}

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('❌ Error: Excel file path is required');
      console.error('\nUsage: node assign_acs_to_cati_interviewers.js <excel_file> [survey_id] [assigned_by_user_id]');
      console.error('\nExample:');
      console.error('  node assign_acs_to_cati_interviewers.js "Int ID wise ACs for 1st Week of Feb.xlsx"');
      console.error('  node assign_acs_to_cati_interviewers.js "file.xlsx" 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const excelPath = path.isAbsolute(args[0]) 
      ? args[0] 
      : path.join('/var/www/Report-Generation/newcontacts', args[0]);
    
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    const assignedByUserId = args[2] || null;
    
    console.log('='.repeat(70));
    console.log('ASSIGN ACs TO CATI INTERVIEWERS');
    console.log('='.repeat(70));
    console.log(`Excel File: ${excelPath}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log(`Assigned By User ID: ${assignedByUserId || 'Not specified (will use interviewer ID)'}`);
    console.log('='.repeat(70));
    
    // Load AC JSON
    console.log('\n📖 Loading Assembly Constituencies JSON...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
    
    // Connect to database
    await connectDB();
    
    // Read Excel file
    const { mappings, errors: excelErrors } = readExcelFile(excelPath);
    
    if (mappings.length === 0) {
      console.log('❌ No valid mappings found in Excel file');
      process.exit(1);
    }
    
    // Assign ACs
    const results = await assignACsToInterviewers(surveyId, mappings, acMap, assignedByUserId);
    
    // Print results
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(70));
    console.log('ASSIGNMENT RESULTS');
    console.log('='.repeat(70));
    console.log(`✅ Successfully assigned: ${results.successful.length}`);
    console.log(`⚠️  Already assigned: ${results.alreadyAssigned.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`❓ Interviewers not found: ${results.notFound.length}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(70));
    
    if (results.successful.length > 0) {
      console.log('\n✅ Successfully Assigned:');
      results.successful.forEach(r => {
        console.log(`  - ${r.interviewerName} (${r.memberId}): ${r.acName} (${r.acCodeFormatted})`);
      });
    }
    
    if (results.alreadyAssigned.length > 0) {
      console.log('\n⚠️  Already Assigned (skipped):');
      results.alreadyAssigned.forEach(r => {
        console.log(`  - ${r.interviewerName} (${r.memberId}): ${r.acName} (${formatACCodeForLookup(r.acCode)})`);
      });
    }
    
    if (results.notFound.length > 0) {
      console.log('\n❓ Interviewers Not Found:');
      results.notFound.forEach(r => {
        console.log(`  - Member ID: ${r.memberId}, Name: ${r.interviewerName}, AC: ${r.acCode}`);
      });
    }
    
    if (results.failed.length > 0) {
      console.log('\n❌ Failed Assignments:');
      results.failed.forEach(r => {
        console.log(`  - ${r.interviewerName} (${r.memberId}): ${r.error}`);
      });
    }
    
    // Save summary JSON
    const summary = {
      generatedAt: new Date().toISOString(),
      excelFile: excelPath,
      surveyId: surveyId,
      totalMappings: mappings.length,
      successful: results.successful.length,
      alreadyAssigned: results.alreadyAssigned.length,
      failed: results.failed.length,
      notFound: results.notFound.length,
      durationSeconds: duration,
      results: {
        successful: results.successful,
        alreadyAssigned: results.alreadyAssigned,
        failed: results.failed,
        notFound: results.notFound
      }
    };
    
    const summaryPath = path.join('/var/www/Report-Generation', `ac_assignment_summary_${Date.now()}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n📊 Summary JSON saved to: ${summaryPath}`);
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(results.failed.length > 0 || results.notFound.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, loadACJson, formatACCodeForLookup, findACName, readExcelFile, assignACsToInterviewers };

