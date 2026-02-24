#!/usr/bin/env node

/**
 * Check which CATI interviewers are assigned Champdani AC
 * and check today's responses from Champdani
 */

const mongoose = require('mongoose');
const path = require('path');

const User = require('../models/User');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_NAME = 'Champdani';

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('CHAMPDANI AC ASSIGNMENT CHECK');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`AC Name: ${AC_NAME}\n`);
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID)
      .populate('catiInterviewers.interviewer', 'memberId firstName lastName phone email')
      .lean();
    
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    
    console.log(`Survey Name: ${survey.surveyName}\n`);
    
    // Find all CATI interviewers assigned to Champdani
    if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
      console.log('❌ No CATI interviewers assigned to this survey');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    const champdaniAssignments = survey.catiInterviewers.filter(assignment => {
      return assignment.assignedACs && 
             Array.isArray(assignment.assignedACs) &&
             assignment.assignedACs.some(ac => 
               ac.toLowerCase().trim() === AC_NAME.toLowerCase().trim()
             );
    });
    
    console.log(`\n📋 CATI Interviewers Assigned to "${AC_NAME}":`);
    console.log(`   Total: ${champdaniAssignments.length}\n`);
    
    if (champdaniAssignments.length === 0) {
      console.log('❌ No interviewers are assigned to Champdani AC');
    } else {
      champdaniAssignments.forEach((assignment, index) => {
        const interviewer = assignment.interviewer;
        console.log(`   ${index + 1}. Member ID: ${interviewer.memberId || 'N/A'}`);
        console.log(`      Name: ${interviewer.firstName || ''} ${interviewer.lastName || ''}`);
        console.log(`      Phone: ${interviewer.phone || 'N/A'}`);
        console.log(`      Email: ${interviewer.email || 'N/A'}`);
        console.log(`      Assigned ACs: ${assignment.assignedACs.join(', ')}`);
        console.log(`      Status: ${assignment.status || 'N/A'}`);
        console.log('');
      });
    }
    
    // Check today's responses from Champdani
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log('='.repeat(80));
    console.log(`TODAY'S RESPONSES FROM "${AC_NAME}"`);
    console.log('='.repeat(80));
    console.log(`Date Range: ${today.toISOString()} to ${tomorrow.toISOString()}\n`);
    
    // Get all CATI responses from Champdani today
    const todayResponses = await SurveyResponse.find({
      survey: SURVEY_ID,
      interviewMode: { $regex: /cati/i },
      selectedAC: { $regex: new RegExp(AC_NAME, 'i') },
      createdAt: {
        $gte: today,
        $lt: tomorrow
      }
    })
      .populate('interviewer', 'memberId firstName lastName')
      .select('responseId interviewer selectedAC status createdAt')
      .lean();
    
    console.log(`📊 Total CATI Responses from "${AC_NAME}" Today: ${todayResponses.length}\n`);
    
    if (todayResponses.length > 0) {
      // Group by interviewer
      const byInterviewer = {};
      const byStatus = {
        'Approved': 0,
        'Pending_Approval': 0,
        'Rejected': 0,
        'completed': 0,
        'other': 0
      };
      
      todayResponses.forEach(response => {
        const interviewerId = response.interviewer?._id?.toString() || 'Unknown';
        const memberId = response.interviewer?.memberId || 'N/A';
        const name = response.interviewer ? 
          `${response.interviewer.firstName || ''} ${response.interviewer.lastName || ''}`.trim() : 
          'Unknown';
        
        if (!byInterviewer[interviewerId]) {
          byInterviewer[interviewerId] = {
            memberId,
            name,
            count: 0,
            responses: []
          };
        }
        
        byInterviewer[interviewerId].count++;
        byInterviewer[interviewerId].responses.push({
          responseId: response.responseId,
          status: response.status,
          createdAt: response.createdAt
        });
        
        // Count by status
        if (byStatus.hasOwnProperty(response.status)) {
          byStatus[response.status]++;
        } else {
          byStatus.other++;
        }
      });
      
      console.log('📋 Responses by Interviewer:');
      Object.values(byInterviewer)
        .sort((a, b) => b.count - a.count)
        .forEach((data, index) => {
          console.log(`   ${index + 1}. ${data.name} (${data.memberId}): ${data.count} responses`);
        });
      
      console.log('\n📊 Responses by Status:');
      Object.entries(byStatus)
        .filter(([status, count]) => count > 0)
        .forEach(([status, count]) => {
          console.log(`   - ${status}: ${count}`);
        });
      
      // Check if any responses are from interviewers NOT assigned to Champdani
      const unassignedInterviewers = Object.values(byInterviewer).filter(data => {
        const interviewerId = Object.keys(byInterviewer).find(
          id => byInterviewer[id].memberId === data.memberId
        );
        return !champdaniAssignments.some(assignment => 
          assignment.interviewer._id.toString() === interviewerId
        );
      });
      
      if (unassignedInterviewers.length > 0) {
        console.log('\n⚠️  WARNING: Some responses are from interviewers NOT assigned to Champdani:');
        unassignedInterviewers.forEach(data => {
          console.log(`   - ${data.name} (${data.memberId}): ${data.count} responses`);
        });
        console.log('\n   This suggests they may be using priority-based selection (no AC assigned).');
      }
    }
    
    // Check priority file for Champdani
    console.log('\n' + '='.repeat(80));
    console.log('PRIORITY FILE CHECK');
    console.log('='.repeat(80));
    
    try {
      const fs = require('fs');
      const priorityPath = path.join(__dirname, '../data/CATI_AC_Priority.json');
      if (fs.existsSync(priorityPath)) {
        const priorityData = JSON.parse(fs.readFileSync(priorityPath, 'utf8'));
        const champdaniPriority = priorityData.find(
          item => item.AC_Name && item.AC_Name.toLowerCase().trim() === AC_NAME.toLowerCase().trim()
        );
        
        if (champdaniPriority) {
          console.log(`✅ Champdani found in priority file:`);
          console.log(`   Priority: ${champdaniPriority.Priority}`);
          console.log(`   Type: ${champdaniPriority.Type}`);
          
          if (champdaniPriority.Priority !== '0' && champdaniPriority.Priority !== 0) {
            console.log(`\n   ⚠️  Champdani has priority ${champdaniPriority.Priority}, so interviewers without assigned ACs`);
            console.log(`      will get Champdani respondents based on priority!`);
          }
        } else {
          console.log(`❌ Champdani NOT found in priority file`);
        }
      } else {
        console.log(`⚠️  Priority file not found at ${priorityPath}`);
      }
    } catch (error) {
      console.log(`⚠️  Error reading priority file: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();













