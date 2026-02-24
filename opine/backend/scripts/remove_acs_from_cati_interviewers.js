#!/usr/bin/env node

/**
 * Remove ACs from CATI Interviewers Script
 * 
 * This script reads an Excel file with interviewer memberIDs and removes
 * their AC assignments from the survey's catiInterviewers array.
 * 
 * Usage:
 *   node remove_acs_from_cati_interviewers.js <excel_file> <survey_id>
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const Survey = require('../models/Survey');
const User = require('../models/User');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const EXCEL_BASE_PATH = '/var/www/Report-Generation/newcontacts';

/**
 * Read Excel file and extract interviewer memberIDs
 */
function readExcelFile(excelPath) {
  console.log(`\n📖 Reading Excel file: ${excelPath}`);
  
  // Use Python script to read Excel file
  const pythonScriptPath = '/var/www/Report-Generation/read_excel_to_json.py';
  
  try {
    const output = execSync(`python3 "${pythonScriptPath}" "${excelPath}"`, { 
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    const data = JSON.parse(output.trim());
    
    console.log(`✅ Loaded ${data.length} rows from Excel`);
    
    // Extract memberIDs
    const memberIds = [];
    const errors = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // +2 for header and 0-index
      
      const interviewerId = row['Interviewer ID'] || row['interviewer ID'] || row['InterviewerID'];
      
      if (!interviewerId && interviewerId !== 0) {
        errors.push(`Row ${rowNum}: Missing Interviewer ID`);
        continue;
      }
      
      memberIds.push({
        memberId: String(interviewerId).trim(),
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
    
    console.log(`✅ Extracted ${memberIds.length} valid interviewer memberIDs`);
    
    return { memberIds, errors };
  } catch (error) {
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
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
 * Remove ACs from interviewers
 */
async function removeACsFromInterviewers(surveyId, memberIds) {
  console.log(`\n📊 Processing ${memberIds.length} interviewer AC removals...`);
  
  // Load survey
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  console.log(`✅ Found survey: ${survey.surveyName}`);
  
  // Initialize catiInterviewers if it doesn't exist
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
    console.log('⚠️  No CATI interviewers found in survey');
    return { successful: [], notFound: [], notInSurvey: [] };
  }
  
  const results = {
    successful: [],
    notFound: [],
    notInSurvey: []
  };
  
  // Process each memberID
  for (const memberInfo of memberIds) {
    try {
      const { memberId, interviewerName, rowNum } = memberInfo;
      
      // Find user by memberId
      const user = await User.findOne({ memberId: memberId });
      if (!user) {
        results.notFound.push({
          memberId,
          interviewerName,
          rowNum
        });
        continue;
      }
      
      // Find interviewer assignment in survey
      const assignmentIndex = survey.catiInterviewers.findIndex(
        a => a.interviewer.toString() === user._id.toString()
      );
      
      if (assignmentIndex === -1) {
        results.notInSurvey.push({
          memberId,
          interviewerId: user._id.toString(),
          interviewerName: `${user.firstName} ${user.lastName}`,
          rowNum
        });
        continue;
      }
      
      const assignment = survey.catiInterviewers[assignmentIndex];
      
      // Store the ACs that were removed for reporting
      const removedACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
      
      // Clear assignedACs
      assignment.assignedACs = [];
      
      results.successful.push({
        memberId,
        interviewerId: user._id.toString(),
        interviewerName: `${user.firstName} ${user.lastName}`,
        removedACs: removedACs,
        rowNum
      });
      
    } catch (error) {
      console.error(`❌ Error processing ${memberInfo.memberId}:`, error.message);
    }
  }
  
  // Save survey if any changes were made
  if (results.successful.length > 0) {
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
      console.error('\nUsage: node remove_acs_from_cati_interviewers.js <excel_file> [survey_id]');
      console.error('\nExample:');
      console.error('  node remove_acs_from_cati_interviewers.js "Int ID wise ACs for 1st Week of Feb.xlsx"');
      console.error('  node remove_acs_from_cati_interviewers.js "file.xlsx" 68fd1915d41841da463f0d46');
      process.exit(1);
    }
    
    const excelPath = path.isAbsolute(args[0]) 
      ? args[0] 
      : path.join(EXCEL_BASE_PATH, args[0]);
    
    const surveyId = args[1] || DEFAULT_SURVEY_ID;
    
    console.log('='.repeat(70));
    console.log('REMOVE ACs FROM CATI INTERVIEWERS');
    console.log('='.repeat(70));
    console.log(`Excel File: ${excelPath}`);
    console.log(`Survey ID: ${surveyId}`);
    console.log('='.repeat(70));
    
    // Connect to database
    await connectDB();
    
    // Read Excel file
    const { memberIds, errors: excelErrors } = readExcelFile(excelPath);
    
    if (memberIds.length === 0) {
      console.log('❌ No valid memberIDs found in Excel file');
      process.exit(1);
    }
    
    // Remove ACs
    const results = await removeACsFromInterviewers(surveyId, memberIds);
    
    // Print results
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(70));
    console.log('REMOVAL RESULTS');
    console.log('='.repeat(70));
    console.log(`✅ Successfully removed ACs: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.notFound.length + results.notInSurvey.length}`);
    console.log(`   - Interviewers not found: ${results.notFound.length}`);
    console.log(`   - Interviewers not in survey: ${results.notInSurvey.length}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log('='.repeat(70));
    
    if (results.successful.length > 0) {
      console.log('\n✅ Successfully Removed ACs:');
      results.successful.forEach(r => {
        const acsList = r.removedACs.length > 0 ? r.removedACs.join(', ') : 'None';
        console.log(`  - ${r.interviewerName} (${r.memberId}): Removed [${acsList}]`);
      });
    }
    
    if (results.notFound.length > 0) {
      console.log('\n❓ Interviewers Not Found:');
      results.notFound.forEach(r => {
        console.log(`  - Member ID: ${r.memberId}, Name: ${r.interviewerName}`);
      });
    }
    
    if (results.notInSurvey.length > 0) {
      console.log('\n⚠️  Interviewers Not in Survey:');
      results.notInSurvey.forEach(r => {
        console.log(`  - ${r.interviewerName} (${r.memberId})`);
      });
    }
    
    // Save summary JSON
    const summary = {
      generatedAt: new Date().toISOString(),
      excelFile: excelPath,
      surveyId: surveyId,
      totalMemberIds: memberIds.length,
      successful: results.successful.length,
      notFound: results.notFound.length,
      notInSurvey: results.notInSurvey.length,
      durationSeconds: duration,
      results: {
        successful: results.successful,
        notFound: results.notFound,
        notInSurvey: results.notInSurvey
      }
    };
    
    const summaryPath = path.join('/var/www/Report-Generation', `ac_removal_summary_${Date.now()}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n📊 Summary JSON saved to: ${summaryPath}`);
    
    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');
    
    process.exit(results.notFound.length > 0 || results.notInSurvey.length > 0 ? 1 : 0);
    
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

module.exports = { main, readExcelFile, removeACsFromInterviewers };

























































