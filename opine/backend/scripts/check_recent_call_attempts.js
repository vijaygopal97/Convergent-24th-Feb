#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    
    // Get recent call attempts (last 20)
    const recentCalls = await CatiCall.find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .select('callId fromNumber toNumber status callStatus provider createdAt updatedAt webhookReceived metadata queueEntry')
      .populate('queueEntry', 'status assignedTo')
      .lean();
    
    console.log('\n=== Recent Call Attempts (Last 20) ===\n');
    
    const stats = {
      total: recentCalls.length,
      successful: 0,
      failed: 0,
      noWebhook: 0,
      pending: 0,
      byProvider: {},
      byStatus: {}
    };
    
    recentCalls.forEach((call, i) => {
      const provider = call.provider || 'unknown';
      const status = call.callStatus || call.status || 'unknown';
      
      stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
      
      if (status === 'answered' || status === 'completed') {
        stats.successful++;
      } else if (status === 'failed' || status === 'cancelled' || status === 'no-answer') {
        stats.failed++;
      } else if (!call.webhookReceived && Date.now() - new Date(call.createdAt).getTime() > 60000) {
        stats.noWebhook++;
      } else {
        stats.pending++;
      }
      
      console.log(`${i+1}. Call ID: ${call.callId || 'N/A'}`);
      console.log(`   From: ${call.fromNumber} -> To: ${call.toNumber}`);
      console.log(`   Provider: ${provider}`);
      console.log(`   Status: ${status}`);
      console.log(`   Webhook: ${call.webhookReceived ? 'Yes' : 'No'}`);
      console.log(`   Created: ${call.createdAt}`);
      if (call.queueEntry) {
        console.log(`   Queue Status: ${call.queueEntry.status}`);
      }
      console.log('');
    });
    
    console.log('\n=== Statistics ===');
    console.log(`Total Calls: ${stats.total}`);
    console.log(`Successful: ${stats.successful}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`No Webhook (>1min): ${stats.noWebhook}`);
    console.log(`Pending: ${stats.pending}`);
    console.log(`\nBy Provider:`, stats.byProvider);
    console.log(`By Status:`, stats.byStatus);
    
    // Check for calls that were queued but never initiated
    const queueEntries = await CatiRespondentQueue.find({
      status: 'assigned',
      assignedAt: { $gte: new Date(Date.now() - 3600000) } // Last hour
    })
      .sort({ assignedAt: -1 })
      .limit(10)
      .select('phone assignedTo status assignedAt')
      .lean();
    
    if (queueEntries.length > 0) {
      console.log(`\n⚠️  Found ${queueEntries.length} queue entries stuck in 'assigned' status (last hour)`);
    }
    
    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
})();















