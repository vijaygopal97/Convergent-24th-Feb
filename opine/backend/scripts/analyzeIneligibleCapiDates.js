const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

async function analyzeIneligibleCapiDates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();

    // Get all ineligible CAPI responses
    const capiTotal = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi'
    });

    // CAPI Eligibility Query (eligible ones)
    const capiEligibleQuery = {
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $and: [
        {
          $or: [
            { reviewAssignment: { $exists: false } },
            { 'reviewAssignment.assignedTo': null },
            { 'reviewAssignment.expiresAt': { $lt: now } }
          ]
        }
      ],
      'audioRecording.hasAudio': true,
      'audioRecording.fileSize': { $exists: true, $gt: 0 },
      'audioRecording.uploadedAt': { $exists: true, $ne: null },
      'audioRecording.audioUrl': { $exists: true, $type: 'string', $regex: /^audio\/interviews\// },
      'audioRecording.recordingDuration': { $exists: true, $gt: 0 },
      'responses.2': { $exists: true }
    };

    // Get eligible response IDs to exclude
    const eligibleResponses = await SurveyResponse.find(capiEligibleQuery)
      .select('_id')
      .lean();
    const eligibleIds = eligibleResponses.map(r => r._id);

    // Get ineligible CAPI responses with interview start dates
    const ineligibleResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      _id: { $nin: eligibleIds }
    })
      .select('startTime')
      .sort({ startTime: 1 })
      .lean();

    console.log(`📊 Found ${ineligibleResponses.length} ineligible CAPI responses\n`);

    // Group by date
    const dateDistribution = {};
    
    ineligibleResponses.forEach(response => {
      if (!response.startTime) {
        // Handle responses without startTime
        const dateStr = 'No Start Date';
        if (!dateDistribution[dateStr]) {
          dateDistribution[dateStr] = 0;
        }
        dateDistribution[dateStr]++;
        return;
      }
      
      const date = new Date(response.startTime);
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!dateDistribution[dateStr]) {
        dateDistribution[dateStr] = 0;
      }
      dateDistribution[dateStr]++;
    });

    // Sort dates (exclude 'No Start Date')
    const sortedDates = Object.keys(dateDistribution)
      .filter(d => d !== 'No Start Date')
      .sort();
    
    // Group by month for overview
    const monthDistribution = {};
    sortedDates.forEach(dateStr => {
      const month = dateStr.substring(0, 7); // YYYY-MM
      if (!monthDistribution[month]) {
        monthDistribution[month] = 0;
      }
      monthDistribution[month] += dateDistribution[dateStr];
    });
    
    // Add "No Start Date" to month distribution if exists
    if (dateDistribution['No Start Date']) {
      monthDistribution['No Start Date'] = dateDistribution['No Start Date'];
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📅 INTERVIEW START DATE DISTRIBUTION (Monthly)');
    console.log('═══════════════════════════════════════════════════════════');
    
    const sortedMonths = Object.keys(monthDistribution).sort();
    sortedMonths.forEach(month => {
      console.log(`${month}: ${monthDistribution[month]} responses`);
    });
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📅 INTERVIEW START DATE DISTRIBUTION (Daily - First 50 days)');
    console.log('═══════════════════════════════════════════════════════════');
    
    // Show "No Start Date" first if exists
    if (dateDistribution['No Start Date']) {
      console.log(`No Start Date: ${dateDistribution['No Start Date']} responses`);
    }
    
    let count = 0;
    sortedDates.forEach(dateStr => {
      if (count < 50) {
        console.log(`${dateStr}: ${dateDistribution[dateStr]} responses`);
        count++;
      }
    });
    
    if (sortedDates.length > 50) {
      console.log(`\n... and ${sortedDates.length - 50} more days`);
    }

    // Statistics
    const oldestDate = sortedDates.length > 0 ? sortedDates[0] : 'N/A';
    const newestDate = sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : 'N/A';
    const totalDays = sortedDates.length;
    const avgPerDay = totalDays > 0 ? (ineligibleResponses.length / totalDays).toFixed(2) : 'N/A';
    const noStartDateCount = dateDistribution['No Start Date'] || 0;

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 STATISTICS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Oldest interview start date: ${oldestDate}`);
    console.log(`Newest interview start date: ${newestDate}`);
    console.log(`Total days with interviews: ${totalDays}`);
    console.log(`Average per day: ${avgPerDay}`);
    console.log(`Responses without start date: ${noStartDateCount}`);
    console.log(`Total responses: ${ineligibleResponses.length}`);

    // Show top 10 days with most responses
    const topDays = sortedDates
      .map(date => ({ date, count: dateDistribution[date] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔝 TOP 10 DAYS (Most Ineligible CAPI Responses)');
    console.log('═══════════════════════════════════════════════════════════');
    topDays.forEach((day, index) => {
      console.log(`${index + 1}. ${day.date}: ${day.count} responses`);
    });

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

analyzeIneligibleCapiDates();

