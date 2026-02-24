require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

// Get today's date range in IST (UTC+5:30)
const getTodayISTRange = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
  const istNow = new Date(now.getTime() + istOffset);
  
  // Start of today in IST (00:00:00)
  const startOfDayIST = new Date(istNow);
  startOfDayIST.setUTCHours(0, 0, 0, 0);
  const startOfDayUTC = new Date(startOfDayIST.getTime() - istOffset);
  
  // End of today in IST (23:59:59.999)
  const endOfDayIST = new Date(istNow);
  endOfDayIST.setUTCHours(23, 59, 59, 999);
  const endOfDayUTC = new Date(endOfDayIST.getTime() - istOffset);
  
  return { startOfDayUTC, endOfDayUTC };
};

const getActiveCatiInterviewersToday = async () => {
  try {
    console.log('======================================================================');
    console.log('GET ACTIVE CATI INTERVIEWERS TODAY');
    console.log('======================================================================\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Get today's date range
    const { startOfDayUTC, endOfDayUTC } = getTodayISTRange();
    console.log(`📅 Date Range (IST): ${startOfDayUTC.toISOString()} to ${endOfDayUTC.toISOString()}\n`);

    // Find all CATI responses created today
    const todayResponses = await SurveyResponse.find({
      interviewMode: 'cati',
      startTime: {
        $gte: startOfDayUTC,
        $lte: endOfDayUTC
      }
    })
      .select('interviewer')
      .populate('interviewer', 'memberId firstName lastName')
      .lean();

    console.log(`📊 Total CATI responses today: ${todayResponses.length}\n`);

    // Get unique interviewers
    const uniqueInterviewers = new Map();
    
    todayResponses.forEach(response => {
      if (response.interviewer && response.interviewer.memberId) {
        const memberId = response.interviewer.memberId;
        if (!uniqueInterviewers.has(memberId)) {
          uniqueInterviewers.set(memberId, {
            memberId: memberId,
            name: `${response.interviewer.firstName || ''} ${response.interviewer.lastName || ''}`.trim(),
            responseCount: 0
          });
        }
        uniqueInterviewers.get(memberId).responseCount++;
      }
    });

    // Convert to array and sort by memberId
    const activeInterviewers = Array.from(uniqueInterviewers.values())
      .sort((a, b) => a.memberId.localeCompare(b.memberId));

    console.log('======================================================================');
    console.log('ACTIVE CATI INTERVIEWERS TODAY');
    console.log('======================================================================');
    console.log(`Total Active Interviewers: ${activeInterviewers.length}\n`);

    if (activeInterviewers.length === 0) {
      console.log('❌ No active CATI interviewers found today.\n');
    } else {
      console.log('Member IDs:');
      activeInterviewers.forEach((interviewer, index) => {
        console.log(`  ${index + 1}. ${interviewer.memberId}${interviewer.name ? ` (${interviewer.name})` : ''} - ${interviewer.responseCount} response(s)`);
      });
      console.log('\n');
      
      // Also print just the member IDs in a comma-separated format
      console.log('Member IDs (comma-separated):');
      console.log(activeInterviewers.map(i => i.memberId).join(', '));
      console.log('\n');
    }

    console.log('======================================================================');
    console.log('SUMMARY');
    console.log('======================================================================');
    console.log(`Total Active CATI Interviewers: ${activeInterviewers.length}`);
    console.log(`Total CATI Responses Today: ${todayResponses.length}`);
    console.log('======================================================================\n');

    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed\n');

    return activeInterviewers;

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run the script
getActiveCatiInterviewersToday()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });





































