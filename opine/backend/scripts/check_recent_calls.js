#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const CatiCall = require('../models/CatiCall');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    
    const recentCalls = await CatiCall.find({ provider: 'cloudtelephony' })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('callId fromNumber toNumber status callStatus provider createdAt updatedAt webhookReceived metadata')
      .lean();
    
    console.log('\n=== Recent CloudTelephony Calls (Last 10) ===\n');
    recentCalls.forEach((call, i) => {
      console.log(`${i+1}. Call ID: ${call.callId}`);
      console.log(`   From: ${call.fromNumber} -> To: ${call.toNumber}`);
      console.log(`   Status: ${call.status || 'N/A'}`);
      console.log(`   Call Status: ${call.callStatus || 'N/A'}`);
      console.log(`   Webhook Received: ${call.webhookReceived ? 'Yes' : 'No'}`);
      console.log(`   Created: ${call.createdAt}`);
      console.log(`   Updated: ${call.updatedAt}`);
      if (call.metadata?.deskphoneNumber) {
        console.log(`   Deskphone: ${call.metadata.deskphoneNumber}`);
      }
      console.log('');
    });
    
    // Check for failed calls
    const failedCalls = recentCalls.filter(c => 
      c.callStatus === 'failed' || 
      c.callStatus === 'number_does_not_exist' ||
      c.callStatus === 'no-answer' ||
      (!c.webhookReceived && Date.now() - new Date(c.createdAt).getTime() > 60000)
    );
    
    if (failedCalls.length > 0) {
      console.log(`\n⚠️  Found ${failedCalls.length} potentially failed calls:\n`);
      failedCalls.forEach((call, i) => {
        console.log(`${i+1}. Call ID: ${call.callId} - Status: ${call.callStatus || 'No webhook received'}`);
      });
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
})();















