#!/usr/bin/env node

/**
 * Fix Saptagram Repeating Issue
 * 
 * This script ensures contacts in "calling" status are not reset to pending too quickly
 * and adds Saptagram to priority file if missing
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function fixSaptagramIssue() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FIXING SAPTAGRAM REPEATING ISSUE`);
  console.log('='.repeat(70));
  
  // 1. Ensure Saptagram is in priority file
  const priorityPath = path.join(__dirname, '../data/CATI_AC_Priority.json');
  const priorityData = JSON.parse(fs.readFileSync(priorityPath, 'utf8'));
  
  const saptagramIndex = priorityData.findIndex(item => 
    item.AC_Name && item.AC_Name.toLowerCase() === 'saptagram'
  );
  
  if (saptagramIndex === -1) {
    console.log('\n📋 Adding Saptagram to priority file...');
    priorityData.push({
      Type: 'CATI',
      AC_Name: 'Saptagram',
      Priority: '1'
    });
    
    priorityData.sort((a, b) => {
      const nameA = (a.AC_Name || '').toLowerCase();
      const nameB = (b.AC_Name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    fs.writeFileSync(priorityPath, JSON.stringify(priorityData, null, 2));
    console.log('✅ Added Saptagram to priority file with priority 1');
  } else {
    console.log('\n✅ Saptagram already in priority file');
    if (priorityData[saptagramIndex].Priority === '0' || priorityData[saptagramIndex].Priority === 0) {
      console.log('⚠️  But priority is 0 - updating to 1...');
      priorityData[saptagramIndex].Priority = '1';
      fs.writeFileSync(priorityPath, JSON.stringify(priorityData, null, 2));
      console.log('✅ Updated Saptagram priority to 1');
    }
  }
  
  // 2. Check for any stuck contacts in calling status that should be reset
  const surveyId = DEFAULT_SURVEY_ID;
  const callingContacts = await CatiRespondentQueue.find({
    survey: surveyId,
    'respondentContact.ac': 'Saptagram',
    status: 'calling'
  })
  .select('assignedAt callAttempts')
  .lean();
  
  console.log(`\n📊 Contacts in CALLING status for Saptagram: ${callingContacts.length}`);
  
  // Check if any have been in calling status for too long (more than 1 hour)
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  
  const stuckInCalling = callingContacts.filter(contact => {
    if (!contact.assignedAt) return false;
    return new Date(contact.assignedAt) < oneHourAgo;
  });
  
  console.log(`📊 Contacts stuck in CALLING for >1 hour: ${stuckInCalling.length}`);
  
  if (stuckInCalling.length > 0) {
    console.log(`\n⚠️  Found ${stuckInCalling.length} contacts stuck in CALLING status`);
    console.log(`   These should be reset to pending to allow re-assignment`);
    
    // Reset stuck contacts
    const result = await CatiRespondentQueue.updateMany(
      {
        survey: surveyId,
        'respondentContact.ac': 'Saptagram',
        status: 'calling',
        assignedAt: { $lt: oneHourAgo }
      },
      {
        $set: {
          status: 'pending',
          assignedTo: null,
          assignedAt: null
        }
      }
    );
    
    console.log(`✅ Reset ${result.modifiedCount} stuck contacts from CALLING to PENDING`);
  }
  
  // 3. Verify queue status
  const stats = await CatiRespondentQueue.aggregate([
    {
      $match: {
        survey: new mongoose.Types.ObjectId(surveyId),
        'respondentContact.ac': 'Saptagram'
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  console.log(`\n📊 Final queue status for Saptagram:`);
  stats.forEach(stat => {
    console.log(`   ${stat._id}: ${stat.count}`);
  });
  
  await mongoose.connection.close();
  console.log('\n✅ Done');
}

fixSaptagramIssue().catch(console.error);

















































