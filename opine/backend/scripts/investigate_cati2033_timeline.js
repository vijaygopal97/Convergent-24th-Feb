require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const SurveyResponse = require('../models/SurveyResponse');

const investigateTimeline = async () => {
  try {
    console.log('======================================================================');
    console.log('TIMELINE INVESTIGATION: CATI2033 CALL ISSUE');
    console.log('======================================================================\n');

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const user = await User.findOne({ memberId: 'CATI2033' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log(`📋 User: ${user.firstName} ${user.lastName} (${user.memberId})`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   Added to Cloud Telephony: February 7th (as per user)\n`);

    // Check all calls from Feb 7th onwards
    const feb7Start = new Date('2026-02-07T00:00:00.000Z');
    const now = new Date();

    console.log('📞 CALL HISTORY FROM FEB 7TH ONWARDS:');
    const allCalls = await CatiCall.find({
      createdBy: user._id,
      createdAt: { $gte: feb7Start }
    })
      .sort({ createdAt: 1 })
      .lean();

    console.log(`   Total calls found: ${allCalls.length}\n`);

    if (allCalls.length > 0) {
      // Group calls by date
      const callsByDate = {};
      const successfulCalls = [];
      const cancelledCalls = [];
      const failedCalls = [];

      allCalls.forEach(call => {
        const date = call.createdAt.toISOString().split('T')[0];
        if (!callsByDate[date]) {
          callsByDate[date] = { total: 0, successful: 0, cancelled: 0, failed: 0, answered: 0, completed: 0 };
        }
        callsByDate[date].total++;
        
        const status = call.callStatus || call.apiStatus;
        if (status === 'completed' || status === 'answered') {
          callsByDate[date].successful++;
          callsByDate[date].answered++;
          successfulCalls.push(call);
        } else if (status === 'cancelled') {
          callsByDate[date].cancelled++;
          cancelledCalls.push(call);
        } else if (status === 'failed') {
          callsByDate[date].failed++;
          failedCalls.push(call);
        }
      });

      console.log('📊 CALLS BY DATE:');
      Object.keys(callsByDate).sort().forEach(date => {
        const stats = callsByDate[date];
        console.log(`   ${date}:`);
        console.log(`      Total: ${stats.total}`);
        console.log(`      Successful (answered/completed): ${stats.successful}`);
        console.log(`      Cancelled: ${stats.cancelled}`);
        console.log(`      Failed: ${stats.failed}`);
        console.log('');
      });

      // Find when successful calls stopped
      console.log('🔍 SUCCESSFUL CALLS ANALYSIS:');
      if (successfulCalls.length > 0) {
        successfulCalls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const lastSuccessful = successfulCalls[0];
        console.log(`   Last successful call: ${lastSuccessful.createdAt.toISOString()}`);
        console.log(`   Call ID: ${lastSuccessful.callId}`);
        console.log(`   Status: ${lastSuccessful.callStatus}`);
        console.log(`   From: ${lastSuccessful.fromNumber} → To: ${lastSuccessful.toNumber}`);
        console.log('');
      } else {
        console.log('   ⚠️  No successful calls found since Feb 7th\n');
      }

      // Find when cancelled calls started
      console.log('❌ CANCELLED CALLS ANALYSIS:');
      if (cancelledCalls.length > 0) {
        cancelledCalls.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const firstCancelled = cancelledCalls[0];
        console.log(`   First cancelled call: ${firstCancelled.createdAt.toISOString()}`);
        console.log(`   Call ID: ${firstCancelled.callId}`);
        console.log(`   From: ${firstCancelled.fromNumber} → To: ${firstCancelled.toNumber}`);
        if (firstCancelled.webhookData) {
          console.log(`   Webhook Status: ${firstCancelled.webhookData.Status || 'N/A'}`);
          console.log(`   Webhook Destination: ${firstCancelled.webhookData.DestinationNumber || 'N/A'}`);
        }
        console.log('');
      }

      // Check for pattern changes
      console.log('🔍 CHECKING FOR PATTERN CHANGES:');
      
      // Check deskphone number in webhook data
      const deskphoneNumbers = new Set();
      allCalls.forEach(call => {
        if (call.webhookData && call.webhookData.DestinationNumber) {
          deskphoneNumbers.add(call.webhookData.DestinationNumber);
        }
      });
      
      console.log(`   Deskphone numbers found in webhooks: ${Array.from(deskphoneNumbers).join(', ')}`);
      console.log(`   Current configured deskphone: ${process.env.CLOUDTELEPHONY_DESKPHONE || 'Not set'}`);
      console.log('');

      // Check if there's a clear breakpoint
      if (successfulCalls.length > 0 && cancelledCalls.length > 0) {
        const lastSuccessTime = new Date(successfulCalls[0].createdAt);
        const firstCancelTime = new Date(cancelledCalls[0].createdAt);
        
        if (firstCancelTime > lastSuccessTime) {
          const timeDiff = firstCancelTime - lastSuccessTime;
          const hoursDiff = timeDiff / (1000 * 60 * 60);
          console.log('⏰ TIMELINE BREAKPOINT:');
          console.log(`   Last successful call: ${lastSuccessTime.toISOString()}`);
          console.log(`   First cancelled call: ${firstCancelTime.toISOString()}`);
          console.log(`   Time difference: ${hoursDiff.toFixed(2)} hours`);
          console.log('');
        }
      }

      // Check recent calls (last 10) for patterns
      console.log('📞 RECENT CALLS (Last 10):');
      const recentCalls = allCalls.slice(-10);
      recentCalls.forEach((call, index) => {
        console.log(`   ${index + 1}. ${call.createdAt.toISOString()}`);
        console.log(`      Call ID: ${call.callId}`);
        console.log(`      Status: ${call.callStatus || call.apiStatus}`);
        console.log(`      From: ${call.fromNumber} → To: ${call.toNumber}`);
        if (call.webhookData) {
          console.log(`      Webhook Status: ${call.webhookData.Status || 'N/A'}`);
          console.log(`      Webhook Destination: ${call.webhookData.DestinationNumber || 'N/A'}`);
        }
        console.log('');
      });
    }

    // Check CATI responses to see when interviews were completed
    console.log('📋 CATI RESPONSES ANALYSIS:');
    const responses = await SurveyResponse.find({
      interviewer: user._id,
      interviewMode: 'cati',
      createdAt: { $gte: feb7Start }
    })
      .sort({ createdAt: 1 })
      .select('responseId sessionId startTime endTime status call_id knownCallStatus createdAt')
      .lean();

    console.log(`   Total responses: ${responses.length}`);
    
    if (responses.length > 0) {
      const completedResponses = responses.filter(r => r.status === 'Approved' || r.status === 'completed');
      const abandonedResponses = responses.filter(r => r.status === 'abandoned');
      
      console.log(`   Completed/Approved: ${completedResponses.length}`);
      console.log(`   Abandoned: ${abandonedResponses.length}`);
      
      if (completedResponses.length > 0) {
        const lastCompleted = completedResponses[completedResponses.length - 1];
        console.log(`   Last completed response: ${lastCompleted.createdAt.toISOString()}`);
      }
      
      if (abandonedResponses.length > 0) {
        const firstAbandoned = abandonedResponses[0];
        console.log(`   First abandoned response: ${firstAbandoned.createdAt.toISOString()}`);
      }
      console.log('');
    }

    // Check queue entries to see assignment patterns
    console.log('📋 QUEUE ENTRIES ANALYSIS:');
    const queueEntries = await CatiRespondentQueue.find({
      assignedTo: user._id,
      assignedAt: { $gte: feb7Start }
    })
      .sort({ assignedAt: 1 })
      .select('status assignedAt lastAttemptedAt callAttempts')
      .lean();

    console.log(`   Total queue entries: ${queueEntries.length}`);
    
    if (queueEntries.length > 0) {
      const stuckEntries = queueEntries.filter(e => e.status === 'calling');
      const completedEntries = queueEntries.filter(e => e.status === 'completed');
      
      console.log(`   Stuck in "calling" status: ${stuckEntries.length}`);
      console.log(`   Completed: ${completedEntries.length}`);
      
      if (stuckEntries.length > 0) {
        const firstStuck = stuckEntries[0];
        console.log(`   First stuck entry: ${firstStuck.assignedAt.toISOString()}`);
      }
      console.log('');
    }

    await mongoose.connection.close();
    console.log('✅ Investigation complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

investigateTimeline()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });





































