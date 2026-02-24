require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Survey = require('../models/Survey');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const CatiCall = require('../models/CatiCall');
const SurveyResponse = require('../models/SurveyResponse');

const investigateCati2033Issue = async () => {
  try {
    console.log('======================================================================');
    console.log('INVESTIGATING CATI2033 CALL ISSUE');
    console.log('======================================================================\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find user by memberId
    const user = await User.findOne({ memberId: 'CATI2033' });
    if (!user) {
      console.log('❌ User with memberId CATI2033 not found');
      await mongoose.connection.close();
      return;
    }

    console.log('📋 USER INFORMATION:');
    console.log(`   Name: ${user.firstName} ${user.lastName}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Phone: ${user.phone}`);
    console.log(`   User Type: ${user.userType}`);
    console.log(`   Status: ${user.status}`);
    console.log(`   Is Active: ${user.isActive}`);
    console.log(`   User ID: ${user._id}`);
    console.log('');

    // Check recent queue entries assigned to this interviewer
    console.log('📞 RECENT QUEUE ENTRIES ASSIGNED TO CATI2033:');
    const recentQueueEntries = await CatiRespondentQueue.find({
      assignedTo: user._id
    })
      .sort({ assignedAt: -1 })
      .limit(10)
      .populate('survey', 'surveyName')
      .lean();

    if (recentQueueEntries.length === 0) {
      console.log('   ⚠️  No queue entries found assigned to this interviewer\n');
    } else {
      console.log(`   Found ${recentQueueEntries.length} recent queue entries:\n`);
      recentQueueEntries.forEach((entry, index) => {
        console.log(`   ${index + 1}. Queue ID: ${entry._id}`);
        console.log(`      Survey: ${entry.survey?.surveyName || 'N/A'}`);
        console.log(`      Status: ${entry.status}`);
        console.log(`      Assigned At: ${entry.assignedAt || 'N/A'}`);
        console.log(`      Last Attempted At: ${entry.lastAttemptedAt || 'N/A'}`);
        console.log(`      Current Attempt Number: ${entry.currentAttemptNumber || 0}`);
        console.log(`      Call Attempts: ${entry.callAttempts?.length || 0}`);
        if (entry.callAttempts && entry.callAttempts.length > 0) {
          entry.callAttempts.forEach((attempt, idx) => {
            console.log(`         Attempt ${attempt.attemptNumber}: ${attempt.status} - ${attempt.reason || 'N/A'} at ${attempt.attemptedAt}`);
          });
        }
        console.log('');
      });
    }

    // Check recent call attempts in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    console.log('📞 RECENT CALL ATTEMPTS (Last 7 Days):');
    const recentCalls = await CatiCall.find({
      createdBy: user._id,
      createdAt: { $gte: sevenDaysAgo }
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    if (recentCalls.length === 0) {
      console.log('   ⚠️  No call records found in the last 7 days\n');
    } else {
      console.log(`   Found ${recentCalls.length} call records:\n`);
      recentCalls.forEach((call, index) => {
        console.log(`   ${index + 1}. Call ID: ${call.callId}`);
        console.log(`      From: ${call.fromNumber} → To: ${call.toNumber}`);
        console.log(`      Status: ${call.callStatus || call.apiStatus}`);
        console.log(`      API Status: ${call.apiStatus}`);
        console.log(`      Created At: ${call.createdAt}`);
        console.log(`      Error: ${call.apiErrorMessage || call.errorMessage || 'N/A'}`);
        console.log(`      Webhook Received: ${call.webhookReceived || false}`);
        if (call.gatewayResponse) {
          console.log(`      Gateway Response: ${JSON.stringify(call.gatewayResponse)}`);
        }
        console.log('');
      });
    }

    // Check recent CATI responses
    console.log('📋 RECENT CATI RESPONSES (Last 7 Days):');
    const recentResponses = await SurveyResponse.find({
      interviewer: user._id,
      interviewMode: 'cati',
      createdAt: { $gte: sevenDaysAgo }
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('responseId sessionId startTime endTime status call_id knownCallStatus')
      .lean();

    if (recentResponses.length === 0) {
      console.log('   ⚠️  No CATI responses found in the last 7 days\n');
    } else {
      console.log(`   Found ${recentResponses.length} CATI responses:\n`);
      recentResponses.forEach((response, index) => {
        console.log(`   ${index + 1}. Response ID: ${response.responseId || response._id}`);
        console.log(`      Session ID: ${response.sessionId}`);
        console.log(`      Start Time: ${response.startTime}`);
        console.log(`      Status: ${response.status}`);
        console.log(`      Call ID: ${response.call_id || 'N/A'}`);
        console.log(`      Call Status: ${response.knownCallStatus || 'N/A'}`);
        console.log('');
      });
    }

    // Check for failed call attempts in queue entries
    console.log('❌ FAILED CALL ATTEMPTS IN QUEUE ENTRIES:');
    const failedAttempts = await CatiRespondentQueue.find({
      assignedTo: user._id,
      'callAttempts.status': 'failed'
    })
      .sort({ 'callAttempts.attemptedAt': -1 })
      .limit(10)
      .lean();

    if (failedAttempts.length === 0) {
      console.log('   ⚠️  No failed call attempts found\n');
    } else {
      console.log(`   Found ${failedAttempts.length} queue entries with failed attempts:\n`);
      failedAttempts.forEach((entry, index) => {
        const failedCalls = entry.callAttempts?.filter(a => a.status === 'failed') || [];
        console.log(`   ${index + 1}. Queue ID: ${entry._id}`);
        console.log(`      Status: ${entry.status}`);
        console.log(`      Failed Attempts: ${failedCalls.length}`);
        failedCalls.forEach((attempt, idx) => {
          console.log(`         ${idx + 1}. Attempt ${attempt.attemptNumber}: ${attempt.reason || 'N/A'} at ${attempt.attemptedAt}`);
        });
        console.log('');
      });
    }

    // Check for any errors in the last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    console.log('🔍 RECENT ERRORS (Last 24 Hours):');
    const recentErrors = await CatiCall.find({
      createdBy: user._id,
      createdAt: { $gte: oneDayAgo },
      $or: [
        { apiStatus: 'failed' },
        { callStatus: 'failed' },
        { apiErrorMessage: { $exists: true, $ne: null } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    if (recentErrors.length === 0) {
      console.log('   ✅ No errors found in the last 24 hours\n');
    } else {
      console.log(`   Found ${recentErrors.length} error records:\n`);
      recentErrors.forEach((error, index) => {
        console.log(`   ${index + 1}. Call ID: ${error.callId}`);
        console.log(`      Created At: ${error.createdAt}`);
        console.log(`      API Status: ${error.apiStatus}`);
        console.log(`      Call Status: ${error.callStatus}`);
        console.log(`      Error Message: ${error.apiErrorMessage || error.errorMessage || 'N/A'}`);
        console.log(`      From: ${error.fromNumber} → To: ${error.toNumber}`);
        if (error.apiResponse) {
          console.log(`      API Response: ${JSON.stringify(error.apiResponse, null, 2)}`);
        }
        console.log('');
      });
    }

    // Check if interviewer has any active assignments
    console.log('📊 CURRENT ASSIGNMENTS:');
    const activeAssignments = await CatiRespondentQueue.find({
      assignedTo: user._id,
      status: { $in: ['assigned', 'in_progress'] }
    })
      .countDocuments();

    console.log(`   Active Queue Entries: ${activeAssignments}\n`);

    // Check user's interview modes
    console.log('⚙️  USER CONFIGURATION:');
    console.log(`   Interview Modes: ${user.interviewModes || 'N/A'}`);
    console.log(`   Can Select Mode: ${user.canSelectMode || false}`);
    console.log('');

    console.log('======================================================================');
    console.log('INVESTIGATION COMPLETE');
    console.log('======================================================================\n');

    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the script
investigateCati2033Issue()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

