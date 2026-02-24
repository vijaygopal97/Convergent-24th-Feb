require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const Survey = require('../models/Survey');
const User = require('../models/User');

const PHONE_NUMBER = process.argv[2] || '9832651296';

// Normalize phone number for search (handle different formats)
function normalizePhone(phone) {
  if (!phone) return null;
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  // Remove country code 91 if present
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    cleaned = cleaned.substring(2);
  }
  // Remove leading 0 if present
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  return cleaned;
}

async function investigatePhoneNumber() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI not found in environment variables');
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    const normalizedPhone = normalizePhone(PHONE_NUMBER);
    console.log('==========================================');
    console.log(`Investigating Phone Number: ${PHONE_NUMBER}`);
    console.log(`Normalized: ${normalizedPhone}`);
    console.log('==========================================\n');

    // Search patterns for phone number
    const searchPatterns = [
      normalizedPhone,
      `91${normalizedPhone}`,
      `0${normalizedPhone}`,
      `+91${normalizedPhone}`,
      `+${normalizedPhone}`,
    ];

    // 1. Find CatiCall records
    console.log('📞 CATI CALL RECORDS:');
    console.log('─'.repeat(50));
    
    const callRecords = await CatiCall.find({
      $or: [
        { toNumber: { $in: searchPatterns } },
        { toNumber: { $regex: normalizedPhone } }
      ]
    })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('survey', 'name')
    .populate('queueEntry')
    .populate('createdBy', 'name memberId')
    .lean();

    if (callRecords.length === 0) {
      console.log('❌ No call records found for this number\n');
    } else {
      console.log(`Found ${callRecords.length} call record(s)\n`);
      
      const lastCall = callRecords[0];
      console.log('🔍 LAST CALL DETAILS:');
      console.log('─'.repeat(50));
      console.log(`Call ID: ${lastCall.callId}`);
      console.log(`Created At: ${lastCall.createdAt}`);
      console.log(`From Number: ${lastCall.fromNumber}`);
      console.log(`To Number: ${lastCall.toNumber}`);
      console.log(`Call Status: ${lastCall.callStatus || 'N/A'}`);
      console.log(`API Status: ${lastCall.apiStatus || 'N/A'}`);
      console.log(`Status Description: ${lastCall.statusDescription || 'N/A'}`);
      console.log(`Error Code: ${lastCall.errorCode || 'N/A'}`);
      console.log(`Error Message: ${lastCall.errorMessage || 'N/A'}`);
      console.log(`Webhook Received: ${lastCall.webhookReceived ? 'Yes' : 'No'}`);
      if (lastCall.webhookReceivedAt) {
        console.log(`Webhook Received At: ${lastCall.webhookReceivedAt}`);
      }
      if (lastCall.survey) {
        console.log(`Survey: ${lastCall.survey.name || lastCall.survey._id}`);
      }
      if (lastCall.createdBy) {
        console.log(`Created By: ${lastCall.createdBy.name || lastCall.createdBy.memberId || 'N/A'}`);
      }
      
      // Show webhook data if available
      if (lastCall.webhookData && Object.keys(lastCall.webhookData).length > 0) {
        console.log('\n📋 Webhook Data:');
        console.log(JSON.stringify(lastCall.webhookData, null, 2));
      }
      
      console.log('\n📊 ALL CALL RECORDS SUMMARY:');
      console.log('─'.repeat(50));
      callRecords.forEach((call, index) => {
        console.log(`\n${index + 1}. Call ID: ${call.callId}`);
        console.log(`   Date: ${call.createdAt}`);
        console.log(`   Status: ${call.callStatus || call.apiStatus || 'N/A'}`);
        console.log(`   From: ${call.fromNumber}`);
        console.log(`   To: ${call.toNumber}`);
        if (call.errorMessage) {
          console.log(`   Error: ${call.errorMessage}`);
        }
      });
    }

    // 2. Find CatiRespondentQueue entries
    console.log('\n\n📋 QUEUE ENTRIES:');
    console.log('─'.repeat(50));
    
    const queueEntries = await CatiRespondentQueue.find({
      'respondentContact.phone': { $in: searchPatterns }
    })
    .sort({ lastAttemptedAt: -1, createdAt: -1 })
    .limit(10)
    .populate('survey', 'name')
    .populate('assignedTo', 'name memberId')
    .populate('callAttempts.attemptedBy', 'name memberId')
    .lean();

    if (queueEntries.length === 0) {
      console.log('❌ No queue entries found for this number\n');
    } else {
      console.log(`Found ${queueEntries.length} queue entry/entries\n`);
      
      const lastQueueEntry = queueEntries[0];
      console.log('🔍 LAST QUEUE ENTRY DETAILS:');
      console.log('─'.repeat(50));
      console.log(`Queue Entry ID: ${lastQueueEntry._id}`);
      console.log(`Status: ${lastQueueEntry.status}`);
      console.log(`Created At: ${lastQueueEntry.createdAt}`);
      console.log(`Last Attempted At: ${lastQueueEntry.lastAttemptedAt || 'Never'}`);
      console.log(`Current Attempt Number: ${lastQueueEntry.currentAttemptNumber || 0}`);
      console.log(`Abandonment Reason: ${lastQueueEntry.abandonmentReason || 'N/A'}`);
      console.log(`Abandonment Notes: ${lastQueueEntry.abandonmentNotes || 'N/A'}`);
      if (lastQueueEntry.survey) {
        console.log(`Survey: ${lastQueueEntry.survey.name || lastQueueEntry.survey._id}`);
      }
      if (lastQueueEntry.assignedTo) {
        console.log(`Assigned To: ${lastQueueEntry.assignedTo.name || lastQueueEntry.assignedTo.memberId || 'N/A'}`);
      }
      
      // Show call attempts
      if (lastQueueEntry.callAttempts && lastQueueEntry.callAttempts.length > 0) {
        console.log('\n📞 CALL ATTEMPTS:');
        console.log('─'.repeat(50));
        lastQueueEntry.callAttempts.forEach((attempt, index) => {
          console.log(`\nAttempt ${attempt.attemptNumber}:`);
          console.log(`  Attempted At: ${attempt.attemptedAt}`);
          console.log(`  Status: ${attempt.status || 'N/A'}`);
          console.log(`  Reason: ${attempt.reason || 'N/A'}`);
          console.log(`  Provider: ${attempt.provider || 'N/A'}`);
          console.log(`  Call ID: ${attempt.callId || 'N/A'}`);
          if (attempt.attemptedBy) {
            console.log(`  Attempted By: ${attempt.attemptedBy.name || attempt.attemptedBy.memberId || 'N/A'}`);
          }
          if (attempt.notes) {
            console.log(`  Notes: ${attempt.notes}`);
          }
        });
      }
    }

    // 3. Summary
    console.log('\n\n📊 SUMMARY:');
    console.log('═'.repeat(50));
    if (callRecords.length > 0) {
      const lastCall = callRecords[0];
      console.log(`Last Call Date: ${lastCall.createdAt}`);
      console.log(`Last Call Status: ${lastCall.callStatus || lastCall.apiStatus || 'N/A'}`);
      if (lastCall.errorMessage) {
        console.log(`Last Call Error: ${lastCall.errorMessage}`);
      }
      if (lastCall.callStatus === 'cancelled' || lastCall.callStatus === 'failed') {
        console.log(`\n❌ REASON CALL DIDN'T GO THROUGH:`);
        console.log(`   Status: ${lastCall.callStatus}`);
        console.log(`   Error Code: ${lastCall.errorCode || 'N/A'}`);
        console.log(`   Error Message: ${lastCall.errorMessage || 'N/A'}`);
        console.log(`   Status Description: ${lastCall.statusDescription || 'N/A'}`);
      }
    } else {
      console.log('❌ No call records found - Number may never have been called');
    }

    if (queueEntries.length > 0) {
      const lastQueue = queueEntries[0];
      console.log(`\nLast Queue Status: ${lastQueue.status}`);
      if (lastQueue.abandonmentReason) {
        console.log(`Abandonment Reason: ${lastQueue.abandonmentReason}`);
      }
      if (lastQueue.abandonmentNotes) {
        console.log(`Abandonment Notes: ${lastQueue.abandonmentNotes}`);
      }
    }

    console.log('\n✅ Investigation complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

investigatePhoneNumber();

































