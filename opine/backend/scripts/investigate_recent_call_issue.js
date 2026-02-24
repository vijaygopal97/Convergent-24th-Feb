require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

const investigateRecentIssue = async () => {
  try {
    console.log('======================================================================');
    console.log('INVESTIGATING RECENT CALL ISSUE FOR CATI2033');
    console.log('======================================================================\n');

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const user = await User.findOne({ memberId: 'CATI2033' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }

    const correctPhone = user.phone.replace(/[^0-9]/g, '');
    console.log(`📋 Interviewer: ${user.firstName} ${user.lastName}`);
    console.log(`   Correct Phone: ${correctPhone}`);
    console.log(`   Expected Format: 06291213072 or 6291213072\n`);

    // Check last 2 hours of calls
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    
    console.log('📞 CALLS IN LAST 2 HOURS:');
    const recentCalls = await CatiCall.find({
      createdBy: user._id,
      createdAt: { $gte: twoHoursAgo }
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log(`   Total calls: ${recentCalls.length}\n`);

    if (recentCalls.length > 0) {
      const correctCalls = [];
      const wrongCalls = [];
      
      recentCalls.forEach(call => {
        const fromClean = call.fromNumber.replace(/[^0-9]/g, '');
        const correctClean = correctPhone.replace(/[^0-9]/g, '');
        
        // Check if from number matches interviewer's number (with or without leading 0)
        const matches = fromClean === correctClean || 
                       fromClean === `0${correctClean}` ||
                       fromClean === correctClean.replace(/^0+/, '') ||
                       correctClean === fromClean.replace(/^0+/, '');
        
        if (matches) {
          correctCalls.push(call);
        } else {
          wrongCalls.push(call);
        }
      });

      console.log(`✅ CORRECT CALLS (using interviewer's number): ${correctCalls.length}`);
      if (correctCalls.length > 0) {
        console.log('   Recent correct calls:');
        correctCalls.slice(0, 5).forEach((call, idx) => {
          console.log(`   ${idx + 1}. ${call.createdAt.toISOString()}`);
          console.log(`      From: ${call.fromNumber} → To: ${call.toNumber}`);
          console.log(`      Status: ${call.callStatus || call.apiStatus}`);
          if (call.webhookData) {
            console.log(`      Webhook Status: ${call.webhookData.Status || 'N/A'}`);
          }
          console.log('');
        });
      }

      console.log(`❌ WRONG CALLS (using incorrect from number): ${wrongCalls.length}`);
      if (wrongCalls.length > 0) {
        console.log('   Wrong calls:');
        wrongCalls.forEach((call, idx) => {
          console.log(`   ${idx + 1}. ${call.createdAt.toISOString()}`);
          console.log(`      Call ID: ${call.callId}`);
          console.log(`      From: ${call.fromNumber} (WRONG - should be ${correctPhone})`);
          console.log(`      To: ${call.toNumber}`);
          console.log(`      Status: ${call.callStatus || call.apiStatus}`);
          if (call.webhookData) {
            console.log(`      Webhook Status: ${call.webhookData.Status || 'N/A'}`);
            console.log(`      Webhook Source: ${call.webhookData.SourceNumber || 'N/A'}`);
            console.log(`      Webhook Destination: ${call.webhookData.DestinationNumber || 'N/A'}`);
          }
          console.log('');
        });
      }

      // Check if wrong calls correlate with cancelled status
      const wrongCancelled = wrongCalls.filter(c => c.callStatus === 'cancelled');
      const correctCancelled = correctCalls.filter(c => c.callStatus === 'cancelled');
      
      console.log('📊 CANCELLATION ANALYSIS:');
      console.log(`   Wrong calls cancelled: ${wrongCancelled.length} / ${wrongCalls.length}`);
      console.log(`   Correct calls cancelled: ${correctCancelled.length} / ${correctCalls.length}`);
      console.log('');

      // Check queue entries for these wrong calls
      if (wrongCalls.length > 0) {
        console.log('🔍 CHECKING QUEUE ENTRIES FOR WRONG CALLS:');
        for (const wrongCall of wrongCalls.slice(0, 3)) {
          // Try to find queue entry by call ID or timing
          const queueEntry = await CatiRespondentQueue.findOne({
            assignedTo: user._id,
            'callAttempts.callId': wrongCall.callId
          }).lean();

          if (!queueEntry) {
            // Try to find by timing (within 5 seconds)
            const timeWindow = new Date(wrongCall.createdAt);
            timeWindow.setSeconds(timeWindow.getSeconds() - 5);
            const queueEntryByTime = await CatiRespondentQueue.findOne({
              assignedTo: user._id,
              lastAttemptedAt: {
                $gte: timeWindow,
                $lte: wrongCall.createdAt
              }
            }).lean();

            if (queueEntryByTime) {
              console.log(`   Queue Entry found for call ${wrongCall.callId}:`);
              console.log(`      Queue ID: ${queueEntryByTime._id}`);
              console.log(`      Status: ${queueEntryByTime.status}`);
              console.log(`      Respondent Phone: ${queueEntryByTime.respondentContact?.phone || 'N/A'}`);
              console.log(`      Call Attempts: ${queueEntryByTime.callAttempts?.length || 0}`);
              if (queueEntryByTime.callAttempts && queueEntryByTime.callAttempts.length > 0) {
                queueEntryByTime.callAttempts.forEach((attempt, idx) => {
                  console.log(`         Attempt ${idx + 1}: ${attempt.status} - ${attempt.reason || 'N/A'}`);
                });
              }
              console.log('');
            } else {
              console.log(`   ⚠️  No queue entry found for call ${wrongCall.callId}`);
              console.log('');
            }
          }
        }
      }
    }

    // Check for concurrent calls or race conditions
    console.log('🔄 CHECKING FOR CONCURRENT CALLS:');
    const concurrentCalls = [];
    for (let i = 0; i < recentCalls.length - 1; i++) {
      const call1 = recentCalls[i];
      const call2 = recentCalls[i + 1];
      const timeDiff = Math.abs(new Date(call1.createdAt) - new Date(call2.createdAt));
      if (timeDiff < 2000) { // Within 2 seconds
        concurrentCalls.push({ call1, call2, timeDiff });
      }
    }
    
    if (concurrentCalls.length > 0) {
      console.log(`   Found ${concurrentCalls.length} pairs of concurrent calls:\n`);
      concurrentCalls.slice(0, 3).forEach((pair, idx) => {
        console.log(`   ${idx + 1}. Calls within ${pair.timeDiff}ms:`);
        console.log(`      Call 1: ${pair.call1.fromNumber} → ${pair.call1.toNumber} (${pair.call1.callStatus})`);
        console.log(`      Call 2: ${pair.call2.fromNumber} → ${pair.call2.toNumber} (${pair.call2.callStatus})`);
        console.log('');
      });
    } else {
      console.log('   No concurrent calls detected\n');
    }

    // Check if there are calls from other interviewers with similar numbers
    console.log('🔍 CHECKING FOR OTHER USERS WITH SIMILAR NUMBERS:');
    if (wrongCalls && wrongCalls.length > 0) {
      const wrongNumbers = [...new Set(wrongCalls.map(c => c.fromNumber.replace(/[^0-9]/g, '')))];
      for (const wrongNum of wrongNumbers.slice(0, 3)) {
      const otherUser = await User.findOne({
        phone: { $regex: wrongNum.replace(/^0+/, '') },
        _id: { $ne: user._id }
      }).select('memberId firstName lastName phone').lean();
      
      if (otherUser) {
        console.log(`   Number ${wrongNum} belongs to: ${otherUser.memberId} (${otherUser.firstName} ${otherUser.lastName})`);
        console.log(`      Phone: ${otherUser.phone}`);
        console.log('');
      }
    } else {
      console.log('   No wrong calls to check\n');
    }

    // Check if these wrong numbers are respondent numbers
    console.log('🔍 CHECKING IF WRONG NUMBERS ARE RESPONDENT NUMBERS:');
    if (wrongCalls && wrongCalls.length > 0) {
      const wrongNumbers = [...new Set(wrongCalls.map(c => c.fromNumber.replace(/[^0-9]/g, '')))];
      for (const wrongNum of wrongNumbers.slice(0, 3)) {
        // Check if this is a respondent number in queue entries
        const queueWithThisNumber = await CatiRespondentQueue.findOne({
          'respondentContact.phone': { $regex: wrongNum.replace(/^0+/, '') }
        }).select('respondentContact.phone assignedTo').lean();
        
        if (queueWithThisNumber) {
          console.log(`   Number ${wrongNum} is a RESPONDENT number:`);
          console.log(`      Respondent Phone: ${queueWithThisNumber.respondentContact?.phone || 'N/A'}`);
          console.log(`      Assigned To: ${queueWithThisNumber.assignedTo || 'N/A'}`);
          console.log('');
        }
      }
    }

    await mongoose.connection.close();
    console.log('✅ Investigation complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

investigateRecentIssue()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

