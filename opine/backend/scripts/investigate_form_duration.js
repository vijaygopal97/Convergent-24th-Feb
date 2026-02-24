#!/usr/bin/env node

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

(async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI or MONGODB_URI not found in environment variables');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
    
    // Find user by memberId
    const user = await User.findOne({ memberId: 'CATI2016' });
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }
    
    console.log(`\n👤 User: ${user.firstName} ${user.lastName} (ID: ${user._id})`);
    
    // Get today's date range (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const todayIST = new Date(istNow);
    todayIST.setUTCHours(0, 0, 0, 0);
    const startDateUTC = new Date(todayIST.getTime() - istOffset);
    const endDateUTC = now;
    
    console.log(`\n📅 Date Range (IST): ${todayIST.toISOString()} to ${istNow.toISOString()}`);
    console.log(`📅 Date Range (UTC): ${startDateUTC.toISOString()} to ${endDateUTC.toISOString()}`);
    
    // Get responses for today
    const responses = await SurveyResponse.find({
      interviewer: user._id,
      interviewMode: 'cati',
      startTime: { $gte: startDateUTC, $lte: endDateUTC }
    }).select('_id startTime endTime totalTimeSpent createdAt sessionId metadata').sort({ startTime: 1 }).lean();
    
    console.log(`\n📊 Total Responses: ${responses.length}`);
    
    let totalSeconds = 0;
    let suspiciousResponses = [];
    
    responses.forEach((r, idx) => {
      const duration = r.totalTimeSpent || 0;
      totalSeconds += duration;
      
      // Calculate actual duration from startTime to endTime
      let actualDuration = null;
      if (r.startTime && r.endTime) {
        actualDuration = Math.round((new Date(r.endTime) - new Date(r.startTime)) / 1000);
      }
      
      // Flag responses with large discrepancies
      if (duration > 3600 || (actualDuration && Math.abs(duration - actualDuration) > 300)) {
        suspiciousResponses.push({ 
          idx: idx + 1, 
          duration, 
          actualDuration,
          startTime: r.startTime, 
          endTime: r.endTime, 
          _id: r._id,
          metadata: r.metadata
        });
      }
      
      // Show first 10 responses
      if (idx < 10) {
        const start = r.startTime ? new Date(r.startTime).toISOString() : 'N/A';
        const end = r.endTime ? new Date(r.endTime).toISOString() : 'N/A';
        const hours = Math.floor(duration / 3600);
        const mins = Math.floor((duration % 3600) / 60);
        const secs = duration % 60;
        const actualStr = actualDuration ? `${actualDuration}s` : 'N/A';
        console.log(`  Response ${idx + 1}: Duration=${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} (${duration}s), Actual=${actualStr}, Start=${start}`);
      }
    });
    
    const totalHours = Math.floor(totalSeconds / 3600);
    const totalMins = Math.floor((totalSeconds % 3600) / 60);
    const totalSecs = totalSeconds % 60;
    console.log(`\n⏱️  Total Duration (sum of totalTimeSpent): ${totalHours}:${totalMins.toString().padStart(2, '0')}:${totalSecs.toString().padStart(2, '0')} (${totalSeconds} seconds)`);
    
    if (suspiciousResponses.length > 0) {
      console.log(`\n⚠️  Suspicious Responses (> 1 hour OR > 5 min discrepancy): ${suspiciousResponses.length}`);
      suspiciousResponses.forEach(r => {
        const hours = Math.floor(r.duration / 3600);
        const mins = Math.floor((r.duration % 3600) / 60);
        const secs = r.duration % 60;
        const start = r.startTime ? new Date(r.startTime).toISOString() : 'N/A';
        const end = r.endTime ? new Date(r.endTime).toISOString() : 'N/A';
        const actualStr = r.actualDuration ? `${r.actualDuration}s` : 'N/A';
        const diff = r.actualDuration ? Math.abs(r.duration - r.actualDuration) : 'N/A';
        console.log(`\n  Response ${r.idx}:`);
        console.log(`    - Stored totalTimeSpent: ${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} (${r.duration}s)`);
        console.log(`    - Actual duration (endTime - startTime): ${actualStr}`);
        console.log(`    - Difference: ${diff}s`);
        console.log(`    - Start: ${start}`);
        console.log(`    - End: ${end}`);
        console.log(`    - Response ID: ${r._id}`);
        if (r.metadata && r.metadata.totalTimeSpent !== undefined) {
          console.log(`    - Metadata totalTimeSpent: ${r.metadata.totalTimeSpent}`);
        }
      });
    } else {
      console.log('\n✅ No suspicious responses found');
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
})();

