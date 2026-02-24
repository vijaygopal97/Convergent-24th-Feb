#!/usr/bin/env node

/**
 * Fix Stuck Assigned Contacts
 * 
 * This script resets stuck "assigned" contacts back to "pending" for a specific AC
 * 
 * Usage:
 *   node fix_stuck_assigned_contacts.js <acName> [survey_id] [dry-run]
 */

const mongoose = require('mongoose');
const path = require('path');

const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function fixStuckContacts(acName, surveyId, dryRun = false) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FIXING STUCK ASSIGNED CONTACTS`);
  console.log('='.repeat(70));
  console.log(`AC Name: ${acName}`);
  console.log(`Survey ID: ${surveyId}`);
  console.log(`Dry Run: ${dryRun ? 'YES (no changes will be made)' : 'NO (will make changes)'}`);
  console.log('='.repeat(70));
  
  // Find all assigned contacts for this AC
  const assignedContacts = await CatiRespondentQueue.find({
    survey: surveyId,
    'respondentContact.ac': acName,
    status: 'assigned'
  }).lean();
  
  console.log(`\n📊 Found ${assignedContacts.length} contacts in "assigned" status for ${acName}`);
  
  if (assignedContacts.length === 0) {
    console.log(`✅ No stuck contacts found`);
    return;
  }
  
  // Group by assignedTo to see distribution
  const assignedToCounts = {};
  assignedContacts.forEach(contact => {
    const assignedTo = contact.assignedTo ? contact.assignedTo.toString() : 'NULL';
    assignedToCounts[assignedTo] = (assignedToCounts[assignedTo] || 0) + 1;
  });
  
  console.log(`\n📊 Distribution by assigned interviewer:`);
  Object.entries(assignedToCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([interviewerId, count]) => {
      console.log(`   ${interviewerId}: ${count} contacts`);
    });
  
  if (dryRun) {
    console.log(`\n⚠️  DRY RUN - No changes made`);
    console.log(`   Would reset ${assignedContacts.length} contacts from "assigned" to "pending"`);
    return;
  }
  
  // Reset all assigned contacts to pending
  const result = await CatiRespondentQueue.updateMany(
    {
      survey: surveyId,
      'respondentContact.ac': acName,
      status: 'assigned'
    },
    {
      $set: {
        status: 'pending',
        assignedTo: null,
        assignedAt: null
      }
    }
  );
  
  console.log(`\n✅ Reset ${result.modifiedCount} contacts from "assigned" to "pending"`);
  console.log(`   Matched: ${result.matchedCount} contacts`);
  
  // Verify
  const pendingCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    'respondentContact.ac': acName,
    status: 'pending'
  });
  
  console.log(`\n📊 New queue status for ${acName}:`);
  console.log(`   Pending: ${pendingCount}`);
  
  return {
    acName,
    resetCount: result.modifiedCount,
    newPendingCount: pendingCount
  };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
      console.error('❌ Error: AC name is required');
      console.error('\nUsage: node fix_stuck_assigned_contacts.js <acName> [survey_id] [dry-run]');
      console.error('\nExample:');
      console.error('  node fix_stuck_assigned_contacts.js "Kharagpur Sadar"');
      console.error('  node fix_stuck_assigned_contacts.js "Kharagpur Sadar" 68fd1915d41841da463f0d46');
      console.error('  node fix_stuck_assigned_contacts.js "Kharagpur Sadar" 68fd1915d41841da463f0d46 dry-run');
      process.exit(1);
    }
    
    const acName = args[0];
    let surveyId = DEFAULT_SURVEY_ID;
    let dryRun = false;
    
    // Parse arguments - check if second arg is survey ID or dry-run flag
    if (args.length > 1) {
      if (args[1] === 'dry-run' || args[1] === '--dry-run') {
        dryRun = true;
      } else {
        surveyId = args[1];
        if (args.length > 2 && (args[2] === 'dry-run' || args[2] === '--dry-run')) {
          dryRun = true;
        }
      }
    }
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const result = await fixStuckContacts(acName, surveyId, dryRun);
    
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

