#!/usr/bin/env node

/**
 * Batch AC Assignments
 * 
 * This script handles multiple AC assignments and redistributions
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function assignACToInterviewer(survey, interviewerId, acCode) {
  // Load AC mappings to convert code to name
  const fs = require('fs');
  const acJsonPath = path.join(__dirname, '../data/assemblyConstituencies.json');
  const acData = JSON.parse(fs.readFileSync(acJsonPath, 'utf8'));
  const wbACs = acData.states['West Bengal'].assemblyConstituencies;
  
  // Find AC name from code
  const ac = wbACs.find(a => a.acCode === acCode || a.acCode === `WB${acCode.replace('WB', '')}`);
  if (!ac) {
    return { success: false, message: `AC code ${acCode} not found in mappings` };
  }
  
  const acName = ac.acName;
  
  const assignment = survey.catiInterviewers?.find(
    a => a.interviewer && a.interviewer.toString() === interviewerId.toString()
  );
  
  if (!assignment) {
    return { success: false, message: 'Interviewer not found in survey' };
  }
  
  // Remove all existing ACs and assign only the new one
  assignment.assignedACs = [acName];
  
  await survey.save();
  return { success: true, message: `Assigned ${acName} (${acCode}) to interviewer` };
}

async function redistributeWB193(survey) {
  // AC assignments are stored by AC NAME, not code
  // WB193 = Saptagram, WB222 = Jhargram
  const fs = require('fs');
  const acJsonPath = path.join(__dirname, '../data/assemblyConstituencies.json');
  const acData = JSON.parse(fs.readFileSync(acJsonPath, 'utf8'));
  const wbACs = acData.states['West Bengal'].assemblyConstituencies;
  
  const wb193AC = wbACs.find(ac => ac.acCode === 'WB193');
  const wb222AC = wbACs.find(ac => ac.acCode === 'WB222');
  
  if (!wb193AC || !wb222AC) {
    return { success: false, message: 'Could not find WB193 or WB222 in AC mappings' };
  }
  
  const wb193Name = wb193AC.acName; // "Saptagram"
  const wb222Name = wb222AC.acName;  // "Jhargram"
  
  // Find all interviewers with Saptagram (WB193) assigned
  const interviewersWithWB193 = survey.catiInterviewers?.filter(
    assignment => assignment.assignedACs && assignment.assignedACs.includes(wb193Name)
  ) || [];
  
  if (interviewersWithWB193.length === 0) {
    return { success: false, message: `No interviewers found with ${wb193Name} (WB193) assigned` };
  }
  
  console.log(`\n📊 Found ${interviewersWithWB193.length} interviewers with ${wb193Name} (WB193) assigned`);
  
  // Redistribute evenly between WB193 (Saptagram) and WB222 (Jhargram)
  let assignWB222 = true; // Alternate between WB222 and WB193
  
  for (const assignment of interviewersWithWB193) {
    const user = await User.findById(assignment.interviewer);
    const memberId = user?.memberId || 'Unknown';
    
    // Remove Saptagram (WB193) from the list
    const otherACs = assignment.assignedACs.filter(ac => ac !== wb193Name);
    
    // Add either Jhargram (WB222) or keep Saptagram (WB193) based on alternation
    if (assignWB222) {
      if (!otherACs.includes(wb222Name)) {
        otherACs.push(wb222Name);
      }
      console.log(`   Interviewer ${memberId}: Removed ${wb193Name}, Added ${wb222Name}`);
    } else {
      // Keep Saptagram (WB193)
      if (!otherACs.includes(wb193Name)) {
        otherACs.push(wb193Name);
      }
      console.log(`   Interviewer ${memberId}: Kept ${wb193Name}`);
    }
    
    assignment.assignedACs = otherACs;
    assignWB222 = !assignWB222; // Alternate
  }
  
  await survey.save();
  return { 
    success: true, 
    message: `Redistributed ${wb193Name} (WB193) assignments among ${interviewersWithWB193.length} interviewers between ${wb193Name} and ${wb222Name}` 
  };
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const survey = await Survey.findById(DEFAULT_SURVEY_ID);
    if (!survey) {
      console.log(`❌ Survey ${DEFAULT_SURVEY_ID} not found`);
      process.exit(1);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`BATCH AC ASSIGNMENTS FOR DEFAULT SURVEY`);
    console.log('='.repeat(70));
    
    // 1. Assign WB251 to interviewer 10025
    console.log(`\n📋 Task 1: Assign WB251 to interviewer 10025`);
    const user10025 = await User.findOne({ memberId: '10025' });
    if (!user10025) {
      console.log(`❌ Interviewer 10025 not found`);
    } else {
      const result = await assignACToInterviewer(survey, user10025._id, 'WB251');
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
      }
    }
    
    // 2. Assign WB241 to interviewer 10002
    console.log(`\n📋 Task 2: Assign WB241 to interviewer 10002`);
    const user10002 = await User.findOne({ memberId: '10002' });
    if (!user10002) {
      console.log(`❌ Interviewer 10002 not found`);
    } else {
      const result = await assignACToInterviewer(survey, user10002._id, 'WB241');
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
      }
    }
    
    // 3. Assign WB241 to interviewer 10003
    console.log(`\n📋 Task 3: Assign WB241 to interviewer 10003`);
    const user10003 = await User.findOne({ memberId: '10003' });
    if (!user10003) {
      console.log(`❌ Interviewer 10003 not found`);
    } else {
      const result = await assignACToInterviewer(survey, user10003._id, 'WB241');
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
      }
    }
    
    // 4. Assign WB242 to interviewer 10007
    console.log(`\n📋 Task 4: Assign WB242 to interviewer 10007`);
    const user10007 = await User.findOne({ memberId: '10007' });
    if (!user10007) {
      console.log(`❌ Interviewer 10007 not found`);
    } else {
      const result = await assignACToInterviewer(survey, user10007._id, 'WB242');
      if (result.success) {
        console.log(`✅ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
      }
    }
    
    // 5. Redistribute WB193 assignments
    console.log(`\n📋 Task 5: Redistribute WB193 assignments between WB222 and WB193`);
    const redistributeResult = await redistributeWB193(survey);
    if (redistributeResult.success) {
      console.log(`✅ ${redistributeResult.message}`);
    } else {
      console.log(`⚠️  ${redistributeResult.message}`);
    }
    
    // Reload survey to show final state
    await survey.populate('catiInterviewers.interviewer', 'firstName lastName memberId');
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`FINAL ASSIGNMENTS SUMMARY`);
    console.log('='.repeat(70));
    
    const targetInterviewers = ['10025', '10002', '10003', '10007'];
    for (const memberId of targetInterviewers) {
      const assignment = survey.catiInterviewers?.find(
        a => a.interviewer && a.interviewer.memberId === memberId
      );
      if (assignment) {
        console.log(`\n📋 Interviewer ${memberId} (${assignment.interviewer.firstName} ${assignment.interviewer.lastName}):`);
        console.log(`   Assigned ACs: ${assignment.assignedACs?.join(', ') || 'NONE'}`);
      }
    }
    
    // Show WB193/WB222 assignments
    console.log(`\n📋 Interviewers with WB193 or WB222:`);
    const wb193_222_assignments = survey.catiInterviewers?.filter(
      a => a.assignedACs && (a.assignedACs.includes('WB193') || a.assignedACs.includes('WB222'))
    ) || [];
    
    for (const assignment of wb193_222_assignments) {
      const user = assignment.interviewer;
      console.log(`   ${user.memberId} (${user.firstName} ${user.lastName}): ${assignment.assignedACs?.join(', ')}`);
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();

