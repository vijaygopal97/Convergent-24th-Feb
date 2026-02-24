#!/usr/bin/env node

/**
 * Check Saptagram Assignment Issue
 * 
 * This script checks why the same contacts might be repeating for interviewer 10003
 */

const mongoose = require('mongoose');
const path = require('path');

const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkSaptagramIssue() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  
  const surveyId = DEFAULT_SURVEY_ID;
  const memberId = '10003';
  
  const user = await User.findOne({ memberId });
  if (!user) {
    console.log(`❌ Interviewer ${memberId} not found`);
    return;
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`CHECKING SAPTAGRAM ASSIGNMENT ISSUE FOR INTERVIEWER ${memberId}`);
  console.log('='.repeat(70));
  
  // Get all contacts assigned to this interviewer for Saptagram
  const assignedContacts = await CatiRespondentQueue.find({
    survey: surveyId,
    'respondentContact.ac': 'Saptagram',
    assignedTo: user._id
  })
  .select('respondentContact.phone status assignedAt callAttempts currentAttemptNumber')
  .sort({ assignedAt: -1 })
  .lean();
  
  console.log(`\n📊 Total contacts assigned to interviewer: ${assignedContacts.length}`);
  
  // Check status distribution
  const statusCounts = {};
  assignedContacts.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  });
  
  console.log(`\n📊 Status distribution:`);
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`   ${status}: ${count}`);
  });
  
  // Check for contacts with multiple call attempts
  const contactsWithMultipleAttempts = assignedContacts.filter(
    c => c.currentAttemptNumber && c.currentAttemptNumber > 1
  );
  
  console.log(`\n📊 Contacts with multiple call attempts: ${contactsWithMultipleAttempts.length}`);
  
  if (contactsWithMultipleAttempts.length > 0) {
    console.log(`\n⚠️  Sample contacts with multiple attempts:`);
    contactsWithMultipleAttempts.slice(0, 10).forEach((c, idx) => {
      console.log(`   ${idx + 1}. Phone: ${c.respondentContact?.phone}, Attempts: ${c.currentAttemptNumber}, Status: ${c.status}`);
    });
  }
  
  // Check if any contacts have been reset to pending after being in calling
  // This would indicate they're being re-assigned
  const contactsInCalling = assignedContacts.filter(c => c.status === 'calling');
  const contactsInPending = await CatiRespondentQueue.find({
    survey: surveyId,
    'respondentContact.ac': 'Saptagram',
    status: 'pending'
  })
  .select('respondentContact.phone callAttempts currentAttemptNumber')
  .lean();
  
  // Check if any pending contacts have call attempts (meaning they were reset)
  const pendingWithAttempts = contactsInPending.filter(
    c => c.currentAttemptNumber && c.currentAttemptNumber > 0
  );
  
  console.log(`\n📊 Pending contacts with previous call attempts: ${pendingWithAttempts.length}`);
  
  if (pendingWithAttempts.length > 0) {
    console.log(`\n⚠️  These contacts were reset to pending after failed calls:`);
    pendingWithAttempts.slice(0, 10).forEach((c, idx) => {
      console.log(`   ${idx + 1}. Phone: ${c.respondentContact?.phone}, Attempts: ${c.currentAttemptNumber || 0}`);
    });
    
    console.log(`\n💡 This explains why the same numbers are repeating - they're being reset to pending after failed calls.`);
  }
  
  // Check if Saptagram is in priority file
  const fs = require('fs');
  const priorityPath = path.join(__dirname, '../data/CATI_AC_Priority.json');
  let saptagramInPriority = false;
  let saptagramPriority = null;
  
  try {
    const priorityData = JSON.parse(fs.readFileSync(priorityPath, 'utf8'));
    const saptagramEntry = priorityData.find(item => 
      item.AC_Name && item.AC_Name.toLowerCase() === 'saptagram'
    );
    
    if (saptagramEntry) {
      saptagramInPriority = true;
      saptagramPriority = saptagramEntry.Priority;
    }
  } catch (e) {
    // Ignore
  }
  
  console.log(`\n📋 Saptagram in priority file: ${saptagramInPriority ? 'YES' : 'NO'}`);
  if (saptagramInPriority) {
    console.log(`   Priority: ${saptagramPriority}`);
    if (saptagramPriority === '0' || saptagramPriority === 0) {
      console.log(`   ⚠️  Priority is 0 - this AC is excluded from priority-based selection`);
    }
  } else {
    console.log(`   ⚠️  Saptagram is NOT in priority file - relies on fallback queries`);
  }
  
  await mongoose.connection.close();
  console.log('\n✅ Done');
}

checkSaptagramIssue().catch(console.error);

















































