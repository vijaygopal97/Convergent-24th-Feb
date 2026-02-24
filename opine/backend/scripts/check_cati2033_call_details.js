require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const CatiCall = require('../models/CatiCall');

const checkCallDetails = async () => {
  try {
    console.log('======================================================================');
    console.log('DETAILED CALL ANALYSIS FOR CATI2033');
    console.log('======================================================================\n');

    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const user = await User.findOne({ memberId: 'CATI2033' });
    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('📋 INTERVIEWER DETAILS:');
    console.log(`   Phone Number: ${user.phone}`);
    console.log(`   Phone (cleaned): ${user.phone.replace(/[^0-9]/g, '')}`);
    console.log('');

    // Check the most recent call attempt
    const mostRecentCall = await CatiCall.findOne({
      createdBy: user._id
    })
      .sort({ createdAt: -1 })
      .lean();

    if (mostRecentCall) {
      console.log('📞 MOST RECENT CALL DETAILS:');
      console.log(`   Call ID: ${mostRecentCall.callId}`);
      console.log(`   From Number: ${mostRecentCall.fromNumber}`);
      console.log(`   To Number: ${mostRecentCall.toNumber}`);
      console.log(`   Call Status: ${mostRecentCall.callStatus}`);
      console.log(`   API Status: ${mostRecentCall.apiStatus}`);
      console.log(`   Created At: ${mostRecentCall.createdAt}`);
      console.log(`   Webhook Received: ${mostRecentCall.webhookReceived}`);
      console.log(`   Error Message: ${mostRecentCall.apiErrorMessage || mostRecentCall.errorMessage || 'N/A'}`);
      console.log('');
      
      if (mostRecentCall.webhookData) {
        console.log('📡 WEBHOOK DATA:');
        console.log(JSON.stringify(mostRecentCall.webhookData, null, 2));
        console.log('');
      }

      if (mostRecentCall.gatewayResponse) {
        console.log('🔌 GATEWAY RESPONSE:');
        console.log(JSON.stringify(mostRecentCall.gatewayResponse, null, 2));
        console.log('');
      }
    }

    // Check calls with "cancelled" status
    const cancelledCalls = await CatiCall.find({
      createdBy: user._id,
      callStatus: 'cancelled',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log('❌ RECENT CANCELLED CALLS (Last 24 Hours):');
    if (cancelledCalls.length === 0) {
      console.log('   No cancelled calls found\n');
    } else {
      console.log(`   Found ${cancelledCalls.length} cancelled calls:\n`);
      cancelledCalls.forEach((call, index) => {
        console.log(`   ${index + 1}. Call ID: ${call.callId}`);
        console.log(`      From: ${call.fromNumber} → To: ${call.toNumber}`);
        console.log(`      Created At: ${call.createdAt}`);
        console.log(`      Webhook Data: ${JSON.stringify(call.webhookData || {}, null, 2)}`);
        console.log('');
      });
    }

    // Check current deskphone configuration
    console.log('⚙️  CURRENT CONFIGURATION:');
    console.log(`   CLOUDTELEPHONY_DESKPHONE: ${process.env.CLOUDTELEPHONY_DESKPHONE || 'Not set'}`);
    console.log('');

    await mongoose.connection.close();
    console.log('✅ Investigation complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

checkCallDetails()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });





































