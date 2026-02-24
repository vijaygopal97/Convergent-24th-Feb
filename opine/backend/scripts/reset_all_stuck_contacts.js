#!/usr/bin/env node

/**
 * Reset All Stuck Contacts
 * 
 * This script resets all stuck "assigned" and "calling" contacts back to "pending" across all ACs
 * 
 * Usage:
 *   node reset_all_stuck_contacts.js [survey_id] [dry-run]
 */

const mongoose = require('mongoose');
const path = require('path');

const CatiRespondentQueue = require('../models/CatiRespondentQueue');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

async function resetAllStuckContacts(surveyId, dryRun = false) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESET ALL STUCK CONTACTS`);
  console.log('='.repeat(70));
  console.log(`Survey ID: ${surveyId}`);
  console.log(`Dry Run: ${dryRun ? 'YES (no changes will be made)' : 'NO (will make changes)'}`);
  console.log('='.repeat(70));
  
  // Get counts before reset
  const assignedCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    status: 'assigned'
  });
  
  const callingCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    status: 'calling'
  });
  
  const totalStuck = assignedCount + callingCount;
  
  console.log(`\n📊 Current Status:`);
  console.log(`   Assigned: ${assignedCount.toLocaleString()}`);
  console.log(`   Calling: ${callingCount.toLocaleString()}`);
  console.log(`   Total Stuck: ${totalStuck.toLocaleString()}`);
  
  if (totalStuck === 0) {
    console.log(`\n✅ No stuck contacts found`);
    return;
  }
  
  // Get breakdown by AC before reset
  const stuckByAC = await CatiRespondentQueue.aggregate([
    {
      $match: {
        survey: new mongoose.Types.ObjectId(surveyId),
        status: { $in: ['assigned', 'calling'] }
      }
    },
    {
      $group: {
        _id: {
          ac: '$respondentContact.ac',
          status: '$status'
        },
        count: { $sum: 1 }
      }
    }
  ]);
  
  const acMap = {};
  stuckByAC.forEach(item => {
    const ac = item._id.ac || 'NO AC';
    if (!acMap[ac]) {
      acMap[ac] = { assigned: 0, calling: 0 };
    }
    acMap[ac][item._id.status] = item.count;
  });
  
  const acList = Object.entries(acMap)
    .map(([ac, counts]) => ({
      ac,
      assigned: counts.assigned,
      calling: counts.calling,
      total: counts.assigned + counts.calling
    }))
    .sort((a, b) => b.total - a.total);
  
  console.log(`\n📋 Top 10 ACs with stuck contacts:`);
  acList.slice(0, 10).forEach((item, idx) => {
    console.log(`   ${(idx + 1).toString().padStart(2)}. ${item.ac.padEnd(30)} Assigned: ${item.assigned.toString().padStart(6)} Calling: ${item.calling.toString().padStart(6)} Total: ${item.total.toString().padStart(6)}`);
  });
  
  if (dryRun) {
    console.log(`\n⚠️  DRY RUN - No changes made`);
    console.log(`   Would reset ${totalStuck.toLocaleString()} contacts from "assigned"/"calling" to "pending"`);
    console.log(`   Affecting ${acList.length} ACs`);
    return;
  }
  
  console.log(`\n🔄 Resetting stuck contacts...`);
  
  // Reset assigned contacts
  const assignedResult = await CatiRespondentQueue.updateMany(
    {
      survey: surveyId,
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
  
  // Reset calling contacts
  const callingResult = await CatiRespondentQueue.updateMany(
    {
      survey: surveyId,
      status: 'calling'
    },
    {
      $set: {
        status: 'pending',
        assignedTo: null,
        assignedAt: null,
        callStartedAt: null
      }
    }
  );
  
  console.log(`\n✅ Reset Results:`);
  console.log(`   Assigned → Pending: ${assignedResult.modifiedCount.toLocaleString()}`);
  console.log(`   Calling → Pending: ${callingResult.modifiedCount.toLocaleString()}`);
  console.log(`   Total Reset: ${(assignedResult.modifiedCount + callingResult.modifiedCount).toLocaleString()}`);
  
  // Verify
  const newAssignedCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    status: 'assigned'
  });
  
  const newCallingCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    status: 'calling'
  });
  
  const newPendingCount = await CatiRespondentQueue.countDocuments({
    survey: surveyId,
    status: 'pending'
  });
  
  console.log(`\n📊 New Queue Status:`);
  console.log(`   Pending: ${newPendingCount.toLocaleString()}`);
  console.log(`   Assigned: ${newAssignedCount.toLocaleString()}`);
  console.log(`   Calling: ${newCallingCount.toLocaleString()}`);
  
  return {
    resetAssigned: assignedResult.modifiedCount,
    resetCalling: callingResult.modifiedCount,
    totalReset: assignedResult.modifiedCount + callingResult.modifiedCount,
    newPendingCount,
    affectedACs: acList.length
  };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    
    let surveyId = DEFAULT_SURVEY_ID;
    let dryRun = false;
    
    // Parse arguments
    args.forEach(arg => {
      if (arg === 'dry-run' || arg === '--dry-run') {
        dryRun = true;
      } else if (!dryRun && mongoose.Types.ObjectId.isValid(arg)) {
        surveyId = arg;
      }
    });
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    const result = await resetAllStuckContacts(surveyId, dryRun);
    
    await mongoose.connection.close();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { resetAllStuckContacts };


























