#!/usr/bin/env node

/**
 * Get Unique CATI Interviewers by Date
 * 
 * This script finds all unique interviewers who worked in CATI interviews
 * yesterday, day before yesterday, and today, along with their IDs and phone numbers.
 */

const mongoose = require('mongoose');
const path = require('path');

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * Get date range for a specific day (start and end of day in UTC)
 */
const getDateRange = (date) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  
  return { start, end };
};

/**
 * Format date for display
 */
const formatDate = (date) => {
  return date.toISOString().split('T')[0];
};

/**
 * Main function
 */
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Calculate dates
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBeforeYesterday = new Date(today);
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
    
    const todayRange = getDateRange(today);
    const yesterdayRange = getDateRange(yesterday);
    const dayBeforeYesterdayRange = getDateRange(dayBeforeYesterday);
    
    console.log('📅 Date Ranges:');
    console.log(`   Today: ${formatDate(today)}`);
    console.log(`   Yesterday: ${formatDate(yesterday)}`);
    console.log(`   Day Before Yesterday: ${formatDate(dayBeforeYesterday)}\n`);
    
    // Function to get unique interviewers for a date range
    const getInterviewersForDateRange = async (dateRange, label) => {
      console.log(`🔍 Finding CATI interviewers for ${label}...`);
      
      // Find all CATI responses in the date range
      const responses = await SurveyResponse.find({
        interviewMode: 'cati',
        startTime: {
          $gte: dateRange.start,
          $lte: dateRange.end
        },
        interviewer: { $exists: true, $ne: null }
      })
      .select('interviewer')
      .populate('interviewer', 'memberId phone firstName lastName')
      .lean();
      
      console.log(`   Found ${responses.length} CATI responses`);
      
      // Get unique interviewers
      const interviewerMap = new Map();
      
      responses.forEach(response => {
        if (response.interviewer && response.interviewer._id) {
          const interviewerId = response.interviewer._id.toString();
          if (!interviewerMap.has(interviewerId)) {
            interviewerMap.set(interviewerId, {
              _id: interviewerId,
              memberId: response.interviewer.memberId || 'N/A',
              phone: response.interviewer.phone || 'N/A',
              firstName: response.interviewer.firstName || '',
              lastName: response.interviewer.lastName || '',
              responseCount: 0
            });
          }
          interviewerMap.get(interviewerId).responseCount++;
        }
      });
      
      const interviewers = Array.from(interviewerMap.values());
      console.log(`   ✅ Found ${interviewers.length} unique interviewers\n`);
      
      return interviewers;
    };
    
    // Get interviewers for each day
    const todayInterviewers = await getInterviewersForDateRange(todayRange, 'Today');
    const yesterdayInterviewers = await getInterviewersForDateRange(yesterdayRange, 'Yesterday');
    const dayBeforeYesterdayInterviewers = await getInterviewersForDateRange(dayBeforeYesterdayRange, 'Day Before Yesterday');
    
    // Combine all unique interviewers
    const allInterviewersMap = new Map();
    
    const addToMap = (interviewers, dayLabel) => {
      interviewers.forEach(interviewer => {
        const key = interviewer._id;
        if (!allInterviewersMap.has(key)) {
          allInterviewersMap.set(key, {
            ...interviewer,
            daysActive: []
          });
        }
        if (!allInterviewersMap.get(key).daysActive.includes(dayLabel)) {
          allInterviewersMap.get(key).daysActive.push(dayLabel);
        }
      });
    };
    
    addToMap(todayInterviewers, 'Today');
    addToMap(yesterdayInterviewers, 'Yesterday');
    addToMap(dayBeforeYesterdayInterviewers, 'Day Before Yesterday');
    
    const allInterviewers = Array.from(allInterviewersMap.values());
    
    // Print summary
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Today (${formatDate(today)}): ${todayInterviewers.length} unique interviewers`);
    console.log(`Yesterday (${formatDate(yesterday)}): ${yesterdayInterviewers.length} unique interviewers`);
    console.log(`Day Before Yesterday (${formatDate(dayBeforeYesterday)}): ${dayBeforeYesterdayInterviewers.length} unique interviewers`);
    console.log(`Total Unique Interviewers (across all 3 days): ${allInterviewers.length}`);
    console.log('='.repeat(80));
    console.log('');
    
    // Print detailed list
    console.log('='.repeat(80));
    console.log('DETAILED LIST OF INTERVIEWERS');
    console.log('='.repeat(80));
    console.log('');
    
    // Sort by memberId for easier reading
    allInterviewers.sort((a, b) => {
      const aId = a.memberId || '';
      const bId = b.memberId || '';
      return aId.localeCompare(bId);
    });
    
    // Group by day
    console.log('📅 TODAY:');
    console.log('-'.repeat(80));
    if (todayInterviewers.length === 0) {
      console.log('   No interviewers found');
    } else {
      todayInterviewers.sort((a, b) => (a.memberId || '').localeCompare(b.memberId || ''));
      todayInterviewers.forEach((interviewer, index) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`   ${index + 1}. Member ID: ${interviewer.memberId.padEnd(10)} | Phone: ${interviewer.phone.padEnd(15)} | Name: ${name.padEnd(30)} | Responses: ${interviewer.responseCount}`);
      });
    }
    console.log('');
    
    console.log('📅 YESTERDAY:');
    console.log('-'.repeat(80));
    if (yesterdayInterviewers.length === 0) {
      console.log('   No interviewers found');
    } else {
      yesterdayInterviewers.sort((a, b) => (a.memberId || '').localeCompare(b.memberId || ''));
      yesterdayInterviewers.forEach((interviewer, index) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`   ${index + 1}. Member ID: ${interviewer.memberId.padEnd(10)} | Phone: ${interviewer.phone.padEnd(15)} | Name: ${name.padEnd(30)} | Responses: ${interviewer.responseCount}`);
      });
    }
    console.log('');
    
    console.log('📅 DAY BEFORE YESTERDAY:');
    console.log('-'.repeat(80));
    if (dayBeforeYesterdayInterviewers.length === 0) {
      console.log('   No interviewers found');
    } else {
      dayBeforeYesterdayInterviewers.sort((a, b) => (a.memberId || '').localeCompare(b.memberId || ''));
      dayBeforeYesterdayInterviewers.forEach((interviewer, index) => {
        const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
        console.log(`   ${index + 1}. Member ID: ${interviewer.memberId.padEnd(10)} | Phone: ${interviewer.phone.padEnd(15)} | Name: ${name.padEnd(30)} | Responses: ${interviewer.responseCount}`);
      });
    }
    console.log('');
    
    // Print combined unique list
    console.log('='.repeat(80));
    console.log('ALL UNIQUE INTERVIEWERS (ACROSS ALL 3 DAYS)');
    console.log('='.repeat(80));
    allInterviewers.forEach((interviewer, index) => {
      const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
      const days = interviewer.daysActive.join(', ');
      console.log(`   ${index + 1}. Member ID: ${interviewer.memberId.padEnd(10)} | Phone: ${interviewer.phone.padEnd(15)} | Name: ${name.padEnd(30)} | Active: ${days}`);
    });
    console.log('');
    
    // Generate CSV report
    const fs = require('fs');
    const reportDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const csvPath = path.join(reportDir, `cati_interviewers_${timestamp}.csv`);
    
    const csvRows = [
      'Member ID,Phone,First Name,Last Name,Full Name,Active Days,Total Responses'
    ];
    
    allInterviewers.forEach(interviewer => {
      const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
      csvRows.push([
        interviewer.memberId || 'N/A',
        interviewer.phone || 'N/A',
        interviewer.firstName || '',
        interviewer.lastName || '',
        name,
        interviewer.daysActive.join('; '),
        interviewer.responseCount || 0
      ].join(','));
    });
    
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`📄 CSV report saved: ${csvPath}`);
    console.log('');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();























