const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Import models
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

/**
 * Get top 21 CATI interviewers active today and yesterday
 */
async function getTopCatiInterviewers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Calculate date range (today and yesterday)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    
    console.log(`\n📅 Date Range:`);
    console.log(`   Yesterday Start: ${yesterdayStart.toISOString()}`);
    console.log(`   Today Start: ${todayStart.toISOString()}`);
    console.log(`   Now: ${now.toISOString()}\n`);

    // Aggregate query to get top interviewers
    const topInterviewers = await SurveyResponse.aggregate([
      // Match CATI interviews from today and yesterday
      {
        $match: {
          interviewMode: 'cati',
          createdAt: {
            $gte: yesterdayStart,
            $lte: now
          }
        }
      },
      // Group by interviewer and count interviews
      {
        $group: {
          _id: '$interviewer',
          interviewCount: { $sum: 1 },
          lastInterviewAt: { $max: '$createdAt' },
          firstInterviewAt: { $min: '$createdAt' }
        }
      },
      // Sort by interview count descending
      {
        $sort: { interviewCount: -1 }
      },
      // Limit to top 21
      {
        $limit: 21
      }
    ]);

    // Populate interviewer details
    const interviewerIds = topInterviewers.map(item => item._id);
    const interviewers = await User.find({ _id: { $in: interviewerIds } })
      .select('firstName lastName email phone memberId role')
      .lean();

    // Create a map for quick lookup
    const interviewerMap = {};
    interviewers.forEach(interviewer => {
      interviewerMap[interviewer._id.toString()] = interviewer;
    });

    // Combine data
    const result = topInterviewers.map((item, index) => {
      const interviewer = interviewerMap[item._id.toString()] || {};
      return {
        rank: index + 1,
        interviewerId: item._id.toString(),
        name: `${interviewer.firstName || 'N/A'} ${interviewer.lastName || ''}`.trim(),
        email: interviewer.email || 'N/A',
        phone: interviewer.phone || 'N/A',
        memberId: interviewer.memberId || 'N/A',
        role: interviewer.role || 'N/A',
        interviewCount: item.interviewCount,
        firstInterviewAt: item.firstInterviewAt,
        lastInterviewAt: item.lastInterviewAt
      };
    });

    // Display results
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 TOP 21 CATI INTERVIEWERS (Active Today & Yesterday)');
    console.log('═══════════════════════════════════════════════════════════════\n');

    result.forEach((interviewer, index) => {
      console.log(`${String(interviewer.rank).padStart(2, ' ')}. ${interviewer.name.padEnd(30)} | Interviews: ${String(interviewer.interviewCount).padStart(4)} | Phone: ${interviewer.phone.padEnd(15)} | Member ID: ${interviewer.memberId || 'N/A'}`);
      console.log(`    📧 ${interviewer.email}`);
      console.log(`    🕐 First Interview: ${new Date(interviewer.firstInterviewAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log(`    🕐 Last Interview:  ${new Date(interviewer.lastInterviewAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`\n📈 Total Interviewers Found: ${result.length}`);
    console.log(`📊 Total Interviews: ${result.reduce((sum, item) => sum + item.interviewCount, 0)}\n`);

    // Return JSON format for potential API use
    return result;

  } catch (error) {
    console.error('❌ Error fetching top CATI interviewers:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run the script
if (require.main === module) {
  getTopCatiInterviewers()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = getTopCatiInterviewers;






























