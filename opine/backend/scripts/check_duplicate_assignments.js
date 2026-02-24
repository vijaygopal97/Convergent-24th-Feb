#!/usr/bin/env node

/**
 * Check for Duplicate Assignments
 * 
 * This script checks if the same contacts are being assigned multiple times
 */

const mongoose = require('mongoose');
const path = require('path');

const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkDuplicateAssignments(memberId, surveyId) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`CHECKING DUPLICATE ASSIGNMENTS FOR INTERVIEWER: ${memberId}`);
  console.log('='.repeat(70));
  
  const user = await User.findOne({ memberId: String(memberId) });
  if (!user) {
    console.log(`❌ Interviewer with member ID ${memberId} not found`);
    return;
  }
  
  console.log(`✅ Interviewer: ${user.firstName} ${user.lastName} (${user.memberId})`);
  console.log(`   User ID: ${user._id}`);
  
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    console.log(`❌ Survey ${surveyId} not found`);
    return;
  }
  
  const assignment = survey.catiInterviewers?.find(
    a => a.interviewer && a.interviewer.toString() === user._id.toString()
  );
  
  if (!assignment) {
    console.log(`❌ Interviewer is NOT assigned to this survey`);
    return;
  }
  
  console.log(`\n📋 Assigned ACs: ${assignment.assignedACs?.join(', ') || 'NONE'}`);
  
  // Check for duplicate phone numbers in the queue for assigned ACs
  if (assignment.assignedACs && assignment.assignedACs.length > 0) {
    for (const acName of assignment.assignedACs) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`ANALYZING AC: ${acName}`);
      console.log('='.repeat(70));
      
      // Find all contacts for this AC
      const allContacts = await CatiRespondentQueue.find({
        survey: surveyId,
        'respondentContact.ac': acName
      })
      .select('respondentContact.phone status assignedTo assignedAt')
      .lean();
      
      console.log(`\n📊 Total contacts in queue for ${acName}: ${allContacts.length}`);
      
      // Check for duplicate phone numbers
      const phoneCounts = {};
      allContacts.forEach(contact => {
        const phone = contact.respondentContact?.phone;
        if (phone) {
          phoneCounts[phone] = (phoneCounts[phone] || 0) + 1;
        }
      });
      
      const duplicates = Object.entries(phoneCounts).filter(([phone, count]) => count > 1);
      
      if (duplicates.length > 0) {
        console.log(`\n⚠️  FOUND ${duplicates.length} DUPLICATE PHONE NUMBERS:`);
        duplicates.slice(0, 20).forEach(([phone, count]) => {
          console.log(`   ${phone}: appears ${count} times`);
        });
        if (duplicates.length > 20) {
          console.log(`   ... and ${duplicates.length - 20} more duplicates`);
        }
      } else {
        console.log(`\n✅ No duplicate phone numbers found`);
      }
      
      // Check contacts assigned to this interviewer
      const assignedToThis = allContacts.filter(
        c => c.assignedTo && c.assignedTo.toString() === user._id.toString()
      );
      
      console.log(`\n📊 Contacts assigned to interviewer ${memberId}:`);
      console.log(`   Total: ${assignedToThis.length}`);
      
      const statusCounts = {};
      assignedToThis.forEach(contact => {
        statusCounts[contact.status] = (statusCounts[contact.status] || 0) + 1;
      });
      
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });
      
      // Check for duplicate phones assigned to this interviewer
      const assignedPhones = {};
      assignedToThis.forEach(contact => {
        const phone = contact.respondentContact?.phone;
        if (phone) {
          if (!assignedPhones[phone]) {
            assignedPhones[phone] = [];
          }
          assignedPhones[phone].push({
            status: contact.status,
            assignedAt: contact.assignedAt
          });
        }
      });
      
      const duplicateAssigned = Object.entries(assignedPhones).filter(
        ([phone, entries]) => entries.length > 1
      );
      
      if (duplicateAssigned.length > 0) {
        console.log(`\n❌ CRITICAL: ${duplicateAssigned.length} phone numbers assigned MULTIPLE TIMES to this interviewer:`);
        duplicateAssigned.slice(0, 10).forEach(([phone, entries]) => {
          console.log(`   ${phone}: assigned ${entries.length} times`);
          entries.forEach((entry, idx) => {
            console.log(`      ${idx + 1}. Status: ${entry.status}, Assigned: ${entry.assignedAt}`);
          });
        });
        if (duplicateAssigned.length > 10) {
          console.log(`   ... and ${duplicateAssigned.length - 10} more duplicate assignments`);
        }
      } else {
        console.log(`\n✅ No duplicate assignments found for this interviewer`);
      }
      
      // Check pending contacts
      const pending = allContacts.filter(c => c.status === 'pending');
      console.log(`\n📊 Pending contacts: ${pending.length}`);
      
      // Check if pending contacts have duplicate phones
      const pendingPhones = {};
      pending.forEach(contact => {
        const phone = contact.respondentContact?.phone;
        if (phone) {
          pendingPhones[phone] = (pendingPhones[phone] || 0) + 1;
        }
      });
      
      const duplicatePending = Object.entries(pendingPhones).filter(
        ([phone, count]) => count > 1
      );
      
      if (duplicatePending.length > 0) {
        console.log(`\n⚠️  ${duplicatePending.length} duplicate phone numbers in PENDING status:`);
        duplicatePending.slice(0, 10).forEach(([phone, count]) => {
          console.log(`   ${phone}: ${count} pending entries`);
        });
      }
    }
  }
}

async function main() {
  try {
    const memberId = process.argv[2];
    
    if (!memberId) {
      console.error('Usage: node check_duplicate_assignments.js <memberId>');
      console.error('Example: node check_duplicate_assignments.js 10003');
      process.exit(1);
    }
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    await checkDuplicateAssignments(memberId, DEFAULT_SURVEY_ID);
    
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

















































