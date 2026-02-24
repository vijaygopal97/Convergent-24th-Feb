require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkTopCATIInterviewers() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI or MONGODB_URI not found in environment variables');
    }
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Calculate yesterday and today dates in IST
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    
    // Get current IST time
    const istTime = new Date(now.getTime() + istOffset);
    
    // Today's date in IST (YYYY-MM-DD)
    const todayIST = new Date(istTime);
    todayIST.setUTCHours(0, 0, 0, 0);
    const todayYear = todayIST.getUTCFullYear();
    const todayMonth = todayIST.getUTCMonth();
    const todayDay = todayIST.getUTCDate();
    
    // Yesterday's date in IST
    const yesterdayIST = new Date(todayIST);
    yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
    const yesterdayYear = yesterdayIST.getUTCFullYear();
    const yesterdayMonth = yesterdayIST.getUTCMonth();
    const yesterdayDay = yesterdayIST.getUTCDate();
    
    // Convert IST dates to UTC for MongoDB query
    // IST 00:00:00 = UTC 18:30:00 previous day
    // IST 23:59:59 = UTC 18:29:59 same day
    
    // Yesterday start: IST 00:00:00 = UTC 18:30:00 (day before yesterday)
    const yesterdayStartUTC = new Date(Date.UTC(yesterdayYear, yesterdayMonth, yesterdayDay, 18, 30, 0, 0));
    yesterdayStartUTC.setUTCDate(yesterdayStartUTC.getUTCDate() - 1);
    
    // Today end: IST 23:59:59 = UTC 18:29:59 today
    const todayEndUTC = new Date(Date.UTC(todayYear, todayMonth, todayDay, 18, 29, 59, 999));
    
    console.log('\n📅 Date Range (IST):');
    console.log(`   Yesterday Start: ${yesterdayIST.toISOString().split('T')[0]} 00:00:00 IST`);
    console.log(`   Today End: ${todayIST.toISOString().split('T')[0]} 23:59:59 IST`);
    console.log(`\n📅 Date Range (UTC for query):`);
    console.log(`   From: ${yesterdayStartUTC.toISOString()}`);
    console.log(`   To: ${todayEndUTC.toISOString()}`);

    // Aggregate query to get top 10 CATI interviewers
    const pipeline = [
      {
        $match: {
          survey: mongoose.Types.ObjectId.isValid(SURVEY_ID) ? new mongoose.Types.ObjectId(SURVEY_ID) : SURVEY_ID,
          interviewMode: 'cati',
          startTime: {
            $gte: yesterdayStartUTC,
            $lte: todayEndUTC
          },
          interviewer: { $exists: true, $ne: null } // Ensure interviewer exists
        }
      },
      {
        $group: {
          _id: '$interviewer',
          responseCount: { $sum: 1 },
          approvedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] }
          },
          pendingCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Pending_Approval'] }, 1, 0] }
          },
          rejectedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] }
          },
          abandonedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'Abandoned'] }, 1, 0] }
          }
        }
      },
      {
        $sort: { responseCount: -1 }
      },
      {
        $limit: 10
      }
    ];

    const results = await SurveyResponse.aggregate(pipeline);
    
    console.log(`\n📊 Found ${results.length} interviewers in top 10\n`);


    // Populate interviewer details
    const interviewerIds = results.map(r => r._id).filter(id => id);
    
    // Try to find by ObjectId first
    const validObjectIds = interviewerIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const interviewersById = validObjectIds.length > 0
      ? await User.find({ _id: { $in: validObjectIds } })
          .select('firstName lastName name memberId email userType')
          .lean()
      : [];

    // Also try to find by memberId (in case interviewer field stores memberId as string/number)
    const potentialMemberIds = interviewerIds
      .filter(id => !mongoose.Types.ObjectId.isValid(id))
      .map(id => String(id));
    
    const interviewersByMemberId = potentialMemberIds.length > 0
      ? await User.find({ memberId: { $in: potentialMemberIds } })
          .select('name memberId email userType')
          .lean()
      : [];


    const interviewerMap = {};
    
    // Map by ObjectId
    interviewersById.forEach(interviewer => {
      interviewerMap[interviewer._id.toString()] = interviewer;
    });
    
    // Map by memberId (for cases where interviewer field might be memberId)
    interviewersByMemberId.forEach(interviewer => {
      interviewerMap[String(interviewer.memberId)] = interviewer;
    });

    // Display results
    console.log('🏆 Top 10 CATI Interviewers (Yesterday + Today Combined):\n');
    console.log('Rank | Member ID | Name | Total | Approved | Pending | Rejected | Abandoned');
    console.log('─'.repeat(80));

    results.forEach((result, index) => {
      const idStr = String(result._id);
      const interviewer = interviewerMap[idStr] || null;
      const rank = index + 1;
      const memberId = interviewer?.memberId || idStr; // Use the ID itself if not found
      // Use firstName + lastName if available, otherwise name, otherwise email, otherwise memberId
      const fullName = interviewer?.firstName && interviewer?.lastName
        ? `${interviewer.firstName} ${interviewer.lastName}`.trim()
        : interviewer?.name || interviewer?.email || interviewer?.memberId || 'Unknown';
      
      console.log(
        `${rank.toString().padStart(4)} | ${memberId.padEnd(10)} | ${fullName.padEnd(20)} | ` +
        `${result.responseCount.toString().padStart(5)} | ${result.approvedCount.toString().padStart(8)} | ` +
        `${result.pendingCount.toString().padStart(7)} | ${result.rejectedCount.toString().padStart(8)} | ` +
        `${result.abandonedCount.toString().padStart(9)}`
      );
    });

    // Summary
    const totalResponses = results.reduce((sum, r) => sum + r.responseCount, 0);
    const totalApproved = results.reduce((sum, r) => sum + r.approvedCount, 0);
    const totalPending = results.reduce((sum, r) => sum + r.pendingCount, 0);
    const totalRejected = results.reduce((sum, r) => sum + r.rejectedCount, 0);
    const totalAbandoned = results.reduce((sum, r) => sum + r.abandonedCount, 0);

    console.log('─'.repeat(80));
    console.log(
      `Total | ${'ALL'.padEnd(10)} | ${'Top 10 Combined'.padEnd(20)} | ` +
      `${totalResponses.toString().padStart(5)} | ${totalApproved.toString().padStart(8)} | ` +
      `${totalPending.toString().padStart(7)} | ${totalRejected.toString().padStart(8)} | ` +
      `${totalAbandoned.toString().padStart(9)}`
    );

    // Get total count for all CATI responses in this period (for comparison)
    const totalAllResponses = await SurveyResponse.countDocuments({
      survey: mongoose.Types.ObjectId.isValid(SURVEY_ID) ? new mongoose.Types.ObjectId(SURVEY_ID) : SURVEY_ID,
      interviewMode: 'cati',
      startTime: {
        $gte: yesterdayStartUTC,
        $lte: todayEndUTC
      }
    });

    console.log(`\n📈 Top 10 represent ${((totalResponses / totalAllResponses) * 100).toFixed(2)}% of all CATI responses (${totalResponses}/${totalAllResponses})`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

checkTopCATIInterviewers();

