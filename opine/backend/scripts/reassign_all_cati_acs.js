#!/usr/bin/env node

/**
 * Reassign ACs for All CATI Interviewers
 * 
 * This script finds all CATI interviewers assigned to the default survey
 * who have AC assignments, removes their current ACs, and reassigns them
 * evenly among the provided ACs.
 * 
 * Interviewers without AC assignments are left alone.
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

// ACs to assign (one per interviewer)
const ACS_TO_ASSIGN = ['WB222', 'WB195', 'WB145', 'WB011', 'WB187', 'WB014'];

/**
 * Load AC names from JSON
 */
function loadACNames() {
  const data = JSON.parse(fs.readFileSync(AC_JSON_PATH, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  return acMap;
}

/**
 * Find AC name from code
 */
function findACName(acCode, acMap) {
  const acName = acMap[acCode];
  if (!acName) {
    throw new Error(`AC name not found for code: ${acCode}`);
  }
  return acName;
}

/**
 * Get all CATI interviewers with AC assignments
 */
async function getCatiInterviewersWithACs(surveyId) {
  const survey = await Survey.findById(surveyId)
    .populate('catiInterviewers.interviewer', 'memberId firstName lastName phone')
    .lean();
  
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
    return [];
  }
  
  // Filter interviewers who have AC assignments
  const interviewersWithACs = survey.catiInterviewers.filter(assignment => {
    return assignment.interviewer && 
           assignment.assignedACs && 
           assignment.assignedACs.length > 0;
  });
  
  return interviewersWithACs.map(assignment => ({
    interviewerId: assignment.interviewer._id || assignment.interviewer,
    memberId: assignment.interviewer.memberId || 'N/A',
    firstName: assignment.interviewer.firstName || 'N/A',
    lastName: assignment.interviewer.lastName || 'N/A',
    phone: assignment.interviewer.phone || 'N/A',
    currentACs: assignment.assignedACs || [],
    status: assignment.status || 'assigned'
  }));
}

/**
 * Reassign AC to interviewer
 */
async function reassignACToInterviewer(surveyId, interviewerId, acCode, acName) {
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers) {
    throw new Error('Survey does not have catiInterviewers array');
  }
  
  const assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === interviewerId.toString()
  );
  
  if (!assignment) {
    throw new Error('Interviewer not assigned to survey');
  }
  
  // Store previous ACs for logging
  const previousACs = assignment.assignedACs ? [...assignment.assignedACs] : [];
  
  // Clear existing ACs and assign new one
  assignment.assignedACs = [acName];
  
  survey.markModified('catiInterviewers');
  await survey.save();
  
  return {
    success: true,
    previousACs,
    newAC: acName
  };
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('REASSIGN ACs FOR ALL CATI INTERVIEWERS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`ACs to assign: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log(`Total ACs available: ${ACS_TO_ASSIGN.length}\n`);
    
    // Load AC names
    console.log('📖 Loading AC names...');
    const acNameMap = loadACNames();
    const acCodeToName = {};
    ACS_TO_ASSIGN.forEach(code => {
      acCodeToName[code] = findACName(code, acNameMap);
    });
    console.log('✅ AC names loaded:\n');
    ACS_TO_ASSIGN.forEach(code => {
      console.log(`   ${code}: ${acCodeToName[code]}`);
    });
    console.log('');
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Survey found: ${survey.surveyName}\n`);
    
    // Get all CATI interviewers with AC assignments
    console.log('🔍 Finding CATI interviewers with AC assignments...');
    const interviewersWithACs = await getCatiInterviewersWithACs(SURVEY_ID);
    
    if (interviewersWithACs.length === 0) {
      console.log('⚠️  No CATI interviewers with AC assignments found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`✅ Found ${interviewersWithACs.length} CATI interviewers with AC assignments\n`);
    
    // Distribute interviewers evenly among ACs (round-robin)
    const results = [];
    
    for (let i = 0; i < interviewersWithACs.length; i++) {
      const interviewer = interviewersWithACs[i];
      const acIndex = i % ACS_TO_ASSIGN.length; // Round-robin distribution
      const acCode = ACS_TO_ASSIGN[acIndex];
      const acName = acCodeToName[acCode];
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Interviewer ${i + 1}/${interviewersWithACs.length}`);
      console.log('='.repeat(80));
      console.log(`Member ID: ${interviewer.memberId}`);
      console.log(`Name: ${interviewer.firstName} ${interviewer.lastName}`);
      console.log(`Phone: ${interviewer.phone}`);
      console.log(`Current ACs: ${interviewer.currentACs.join(', ') || 'None'}`);
      console.log(`New AC: ${acCode} (${acName})`);
      
      try {
        // Reassign AC
        const result = await reassignACToInterviewer(
          SURVEY_ID,
          interviewer.interviewerId,
          acCode,
          acName
        );
        
        console.log(`✅ AC reassigned successfully`);
        console.log(`   Removed: ${result.previousACs.join(', ') || 'None'}`);
        console.log(`   Assigned: ${result.newAC}`);
        
        results.push({
          success: true,
          interviewer: {
            memberId: interviewer.memberId,
            firstName: interviewer.firstName,
            lastName: interviewer.lastName,
            phone: interviewer.phone
          },
          previousACs: result.previousACs,
          newAC: {
            code: acCode,
            name: acName
          }
        });
        
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        results.push({
          success: false,
          interviewer: interviewer,
          error: error.message
        });
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Successfully reassigned: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}\n`);
    
    // Distribution summary
    const distribution = {};
    ACS_TO_ASSIGN.forEach(code => {
      distribution[code] = 0;
    });
    
    results.filter(r => r.success).forEach(result => {
      const acCode = result.newAC.code;
      distribution[acCode] = (distribution[acCode] || 0) + 1;
    });
    
    console.log('📊 AC Distribution:\n');
    ACS_TO_ASSIGN.forEach(code => {
      const count = distribution[code] || 0;
      const acName = acCodeToName[code];
      console.log(`   ${code} (${acName}): ${count} interviewer(s)`);
    });
    console.log('');
    
    if (successCount > 0) {
      console.log('✅ Successfully Reassigned Interviewers:\n');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.interviewer.firstName} ${result.interviewer.lastName} (${result.interviewer.memberId})`);
        console.log(`   Previous ACs: ${result.previousACs.join(', ') || 'None'}`);
        console.log(`   New AC: ${result.newAC.code} (${result.newAC.name})`);
        console.log('');
      });
    }
    
    if (errorCount > 0) {
      console.log('❌ Errors:\n');
      results.filter(r => !r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.interviewer.firstName} ${result.interviewer.lastName} (${result.interviewer.memberId})`);
        console.log(`   Error: ${result.error}`);
        console.log('');
      });
    }
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();




















