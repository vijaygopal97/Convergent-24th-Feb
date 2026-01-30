/**
 * Test Cloud Telephony API call timing
 * Measures actual API response time for makeCall
 */

require('dotenv').config();
const CloudTelephonyProvider = require('../services/catiProviders/cloudtelephonyProvider');
const CatiAgent = require('../models/CatiAgent');
const mongoose = require('mongoose');

const FROM_NUMBER = '9958011332';
const TO_NUMBER = '9999999999'; // Dummy number for testing (won't actually connect)

async function testCloudTelephonyTiming() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    // Initialize Cloud Telephony provider
    const provider = new CloudTelephonyProvider({
      apiBaseUrlV2: process.env.CLOUDTELEPHONY_API_BASE_URL_V2,
      apiBaseUrlV3: process.env.CLOUDTELEPHONY_API_BASE_URL_V3,
      addMemberApiUrlV2: process.env.CLOUDTELEPHONY_ADD_MEMBER_API_URL_V2,
      addMemberApiUrlV3: process.env.CLOUDTELEPHONY_ADD_MEMBER_API_URL_V3,
      authCode: process.env.CLOUDTELEPHONY_AUTH_CODE,
      apiUsername: process.env.CLOUDTELEPHONY_API_USERNAME,
      apiPassword: process.env.CLOUDTELEPHONY_API_PASSWORD,
      deskphone: process.env.CLOUDTELEPHONY_DESKPHONE
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📞 Testing Cloud Telephony API Call Timing');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   From Number: ${FROM_NUMBER}`);
    console.log(`   To Number: ${TO_NUMBER} (test number)\n`);

    // Step 1: Check agent registration status
    console.log('🔍 Step 1: Checking agent registration status...');
    const startCheck = Date.now();
    
    // Find user with this phone number
    const User = require('../models/User');
    const user = await User.findOne({ phone: FROM_NUMBER }).lean();
    
    if (!user) {
      console.log('⚠️  User not found with phone number, checking CatiAgent directly...');
    } else {
      console.log(`   Found user: ${user._id}`);
    }
    
    // Check CatiAgent registration
    let agent = null;
    if (user) {
      agent = await CatiAgent.findOne({ user: user._id, phone: FROM_NUMBER }).lean();
    } else {
      agent = await CatiAgent.findOne({ phone: FROM_NUMBER }).lean();
    }
    
    const checkTime = Date.now() - startCheck;
    console.log(`   ✅ Registration check completed in ${checkTime}ms`);
    
    if (agent && agent.providers?.cloudtelephony?.registered) {
      console.log(`   ✅ Agent is registered (agentId: ${agent.providers.cloudtelephony.agentId || 'N/A'})`);
    } else {
      console.log(`   ⚠️  Agent registration status: ${agent ? 'Not registered' : 'Agent record not found'}`);
    }
    console.log('');

    // Step 2: Test makeCall API timing
    console.log('📞 Step 2: Testing makeCall API call timing...');
    console.log('   Starting API call...\n');
    
    const startTime = Date.now();
    let apiResponseTime = 0;
    let callResult = null;
    let error = null;

    try {
      const callStart = Date.now();
      callResult = await provider.makeCall({
        fromNumber: FROM_NUMBER,
        toNumber: TO_NUMBER,
        fromRingTime: 30,
        timeLimit: 60,
        uid: `test_${Date.now()}`
      });
      apiResponseTime = Date.now() - callStart;
      
      console.log(`   ✅ API call completed in ${apiResponseTime}ms`);
      console.log(`   Call ID: ${callResult.callId}`);
      console.log(`   API Response:`, JSON.stringify(callResult.apiResponse, null, 2));
    } catch (apiError) {
      apiResponseTime = Date.now() - startTime;
      error = apiError;
      console.log(`   ❌ API call failed after ${apiResponseTime}ms`);
      console.log(`   Error: ${error.message}`);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        console.log(`   Response Data:`, JSON.stringify(error.response.data, null, 2));
      }
    }

    const totalTime = Date.now() - startTime;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 Timing Results');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Registration Check: ${checkTime}ms`);
    console.log(`   API Call Time: ${apiResponseTime}ms (${(apiResponseTime / 1000).toFixed(2)}s)`);
    console.log(`   Total Test Time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (apiResponseTime > 5000) {
      console.log('⚠️  WARNING: API call took more than 5 seconds!');
      console.log('   This indicates Cloud Telephony API is slow to respond.\n');
    } else if (apiResponseTime > 1000) {
      console.log('ℹ️  INFO: API call took 1-5 seconds (moderate delay).\n');
    } else {
      console.log('✅ API call was fast (< 1 second).\n');
    }

    await mongoose.disconnect();
    console.log('✅ Test complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

testCloudTelephonyTiming();


