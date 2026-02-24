#!/usr/bin/env node

/**
 * Get Top 30 Interviewers from Last 3 Days
 * 
 * Priority:
 * 1. Interviewers who worked TODAY (highest priority)
 * 2. Interviewers from yesterday and day before yesterday
 * 
 * Returns top 30 interviewers sorted by response count, with today's interviewers prioritized.
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Helper function to get IST date boundaries (UTC)
function getISTDateStartUTC(year, month, day) {
  // IST is UTC+5:30, so subtract 5:30 to get UTC start of day
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function getISTDateEndUTC(year, month, day) {
  // IST is UTC+5:30, so end of day is 23:59:59 IST = 18:29:59 UTC
  return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
}

async function getTop30Interviewers() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Calculate date ranges (IST timezone)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istNow = new Date(now.getTime() + istOffset);
    
    // Today (IST)
    const todayIST = new Date(istNow);
    todayIST.setUTCHours(0, 0, 0, 0);
    const todayStart = getISTDateStartUTC(todayIST.getUTCFullYear(), todayIST.getUTCMonth() + 1, todayIST.getUTCDate());
    const todayEnd = getISTDateEndUTC(todayIST.getUTCFullYear(), todayIST.getUTCMonth() + 1, todayIST.getUTCDate());
    
    // Yesterday (IST)
    const yesterdayIST = new Date(todayIST);
    yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
    const yesterdayStart = getISTDateStartUTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth() + 1, yesterdayIST.getUTCDate());
    const yesterdayEnd = getISTDateEndUTC(yesterdayIST.getUTCFullYear(), yesterdayIST.getUTCMonth() + 1, yesterdayIST.getUTCDate());
    
    // Day before yesterday (IST)
    const dayBeforeIST = new Date(yesterdayIST);
    dayBeforeIST.setUTCDate(dayBeforeIST.getUTCDate() - 1);
    const dayBeforeStart = getISTDateStartUTC(dayBeforeIST.getUTCFullYear(), dayBeforeIST.getUTCMonth() + 1, dayBeforeIST.getUTCDate());
    const dayBeforeEnd = getISTDateEndUTC(dayBeforeIST.getUTCFullYear(), dayBeforeIST.getUTCMonth() + 1, dayBeforeIST.getUTCDate());
    
    console.log('='.repeat(80));
    console.log('TOP 30 CATI INTERVIEWERS FROM LAST 3 DAYS');
    console.log('='.repeat(80));
    console.log(`Today (IST): ${todayIST.toISOString().split('T')[0]}`);
    console.log(`Yesterday (IST): ${yesterdayIST.toISOString().split('T')[0]}`);
    console.log(`Day Before Yesterday (IST): ${dayBeforeIST.toISOString().split('T')[0]}\n`);
    
    // Get interviewers who worked TODAY (CATI ONLY)
    console.log('🔍 Fetching CATI interviewers who worked TODAY...');
    const todayResponses = await SurveyResponse.aggregate([
      {
        $match: {
          interviewMode: 'cati', // CATI ONLY - no CAPI responses
          startTime: { $gte: todayStart, $lt: todayEnd }
        }
      },
      {
        $group: {
          _id: '$interviewer',
          responseCount: { $sum: 1 },
          lastResponseTime: { $max: '$startTime' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'interviewerDetails'
        }
      },
      {
        $unwind: '$interviewerDetails'
      },
      {
        $project: {
          _id: 0,
          interviewerId: '$_id',
          memberId: '$interviewerDetails.memberId',
          phone: '$interviewerDetails.phone',
          firstName: '$interviewerDetails.firstName',
          lastName: '$interviewerDetails.lastName',
          responseCount: 1,
          lastResponseTime: 1,
          workedToday: true
        }
      }
    ]);
    
    console.log(`✅ Found ${todayResponses.length} interviewers who worked TODAY\n`);
    
    // Get interviewers who worked in last 3 days (including today)
    const threeDaysAgoStart = dayBeforeStart;
    const threeDaysAgoEnd = todayEnd;
    
    console.log('🔍 Fetching all CATI interviewers from last 3 days...');
    const allResponses = await SurveyResponse.aggregate([
      {
        $match: {
          interviewMode: 'cati', // CATI ONLY - no CAPI responses
          startTime: { $gte: threeDaysAgoStart, $lt: threeDaysAgoEnd }
        }
      },
      {
        $group: {
          _id: '$interviewer',
          responseCount: { $sum: 1 },
          lastResponseTime: { $max: '$startTime' },
          todayCount: {
            $sum: {
              $cond: [
                { $and: [
                  { $gte: ['$startTime', todayStart] },
                  { $lt: ['$startTime', todayEnd] }
                ]},
                1,
                0
              ]
            }
          },
          yesterdayCount: {
            $sum: {
              $cond: [
                { $and: [
                  { $gte: ['$startTime', yesterdayStart] },
                  { $lt: ['$startTime', yesterdayEnd] }
                ]},
                1,
                0
              ]
            }
          },
          dayBeforeCount: {
            $sum: {
              $cond: [
                { $and: [
                  { $gte: ['$startTime', dayBeforeStart] },
                  { $lt: ['$startTime', dayBeforeEnd] }
                ]},
                1,
                0
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'interviewerDetails'
        }
      },
      {
        $unwind: '$interviewerDetails'
      },
      {
        $project: {
          _id: 0,
          interviewerId: '$_id',
          memberId: '$interviewerDetails.memberId',
          phone: '$interviewerDetails.phone',
          firstName: '$interviewerDetails.firstName',
          lastName: '$interviewerDetails.lastName',
          responseCount: 1,
          todayCount: 1,
          yesterdayCount: 1,
          dayBeforeCount: 1,
          lastResponseTime: 1,
          workedToday: { $gt: ['$todayCount', 0] }
        }
      }
    ]);
    
    console.log(`✅ Found ${allResponses.length} total interviewers from last 3 days\n`);
    
    // Sort: First by workedToday (true first), then by responseCount (descending)
    const sortedInterviewers = allResponses.sort((a, b) => {
      // Priority 1: Today's interviewers first
      if (a.workedToday && !b.workedToday) return -1;
      if (!a.workedToday && b.workedToday) return 1;
      
      // Priority 2: By total response count (descending)
      return b.responseCount - a.responseCount;
    });
    
    // Get top 30
    const top30 = sortedInterviewers.slice(0, 30);
    
    console.log('='.repeat(80));
    console.log('TOP 30 CATI INTERVIEWERS (Prioritizing Today\'s Workers)');
    console.log('='.repeat(80));
    console.log('');
    
    // Group by worked today or not
    const todayWorkers = top30.filter(i => i.workedToday);
    const otherWorkers = top30.filter(i => !i.workedToday);
    
    if (todayWorkers.length > 0) {
      console.log(`📊 Interviewers who worked TODAY (${todayWorkers.length}):`);
      todayWorkers.forEach((interviewer, index) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`   ${index + 1}. Member ID: ${String(interviewer.memberId || 'N/A').padEnd(10)} | Phone: ${String(interviewer.phone || 'N/A').padEnd(15)} | Name: ${name.padEnd(30)} | Today: ${interviewer.todayCount || 0} | Total (3 days): ${interviewer.responseCount}`);
      });
      console.log('');
    }
    
    if (otherWorkers.length > 0) {
      console.log(`📊 Interviewers from last 2 days (${otherWorkers.length}):`);
      otherWorkers.forEach((interviewer, index) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`   ${index + 1}. Member ID: ${String(interviewer.memberId || 'N/A').padEnd(10)} | Phone: ${String(interviewer.phone || 'N/A').padEnd(15)} | Name: ${name.padEnd(30)} | Yesterday: ${interviewer.yesterdayCount || 0} | Day Before: ${interviewer.dayBeforeCount || 0} | Total (3 days): ${interviewer.responseCount}`);
      });
      console.log('');
    }
    
    // Generate CSV report
    const reportsDir = path.join(__dirname, '../scripts/reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const csvPath = path.join(reportsDir, `top_30_interviewers_${timestamp}.csv`);
    
    // CSV header
    const csvRows = [
      ['Rank', 'Member ID', 'Phone', 'First Name', 'Last Name', 'Worked Today', 'Today Count', 'Yesterday Count', 'Day Before Count', 'Total (3 Days)', 'Last Response Time'].join(',')
    ];
    
    // CSV data rows
    top30.forEach((interviewer, index) => {
      const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
      const row = [
        index + 1,
        interviewer.memberId || 'N/A',
        interviewer.phone || 'N/A',
        interviewer.firstName || '',
        interviewer.lastName || '',
        interviewer.workedToday ? 'Yes' : 'No',
        interviewer.todayCount || 0,
        interviewer.yesterdayCount || 0,
        interviewer.dayBeforeCount || 0,
        interviewer.responseCount,
        interviewer.lastResponseTime ? new Date(interviewer.lastResponseTime).toISOString() : 'N/A'
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
      csvRows.push(row);
    });
    
    fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
    console.log(`💾 CSV report saved to: ${csvPath}`);
    console.log('');
    
    // Summary
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Filter: CATI interviewers ONLY (interviewMode: 'cati')`);
    console.log(`Total CATI interviewers found: ${allResponses.length}`);
    console.log(`CATI interviewers who worked today: ${todayWorkers.length}`);
    console.log(`Top 30 CATI interviewers selected: ${top30.length}`);
    console.log(`  - From today: ${todayWorkers.length}`);
    console.log(`  - From last 2 days: ${otherWorkers.length}`);
    console.log('');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

getTop30Interviewers();

