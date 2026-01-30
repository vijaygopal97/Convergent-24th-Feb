/**
 * Clear all active review assignments for CAPI and CATI responses
 * This releases all assignments so responses can be reassigned
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function clearReviewAssignments() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();

    // Count active assignments before clearing
    const capiWithAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    const catiWithAssignment = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    console.log('📊 Current Active Assignments:');
    console.log(`   CAPI: ${capiWithAssignment}`);
    console.log(`   CATI: ${catiWithAssignment}`);
    console.log(`   Total: ${capiWithAssignment + catiWithAssignment}\n`);

    // Clear all active assignments (set assignedTo to null and expiresAt to past)
    console.log('🔄 Clearing all active review assignments...\n');

    const capiResult = await SurveyResponse.updateMany(
      {
        survey: new mongoose.Types.ObjectId(SURVEY_ID),
        status: 'Pending_Approval',
        interviewMode: 'capi',
        reviewAssignment: { $exists: true },
        'reviewAssignment.assignedTo': { $ne: null }
      },
      {
        $set: {
          'reviewAssignment.assignedTo': null,
          'reviewAssignment.expiresAt': new Date(0) // Set to epoch (expired)
        }
      }
    );

    const catiResult = await SurveyResponse.updateMany(
      {
        survey: new mongoose.Types.ObjectId(SURVEY_ID),
        status: 'Pending_Approval',
        interviewMode: 'cati',
        reviewAssignment: { $exists: true },
        'reviewAssignment.assignedTo': { $ne: null }
      },
      {
        $set: {
          'reviewAssignment.assignedTo': null,
          'reviewAssignment.expiresAt': new Date(0) // Set to epoch (expired)
        }
      }
    );

    console.log('✅ Review assignments cleared:');
    console.log(`   CAPI: ${capiResult.modifiedCount} assignments cleared`);
    console.log(`   CATI: ${catiResult.modifiedCount} assignments cleared`);
    console.log(`   Total: ${capiResult.modifiedCount + catiResult.modifiedCount} assignments cleared\n`);

    // Verify
    const capiAfter = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'capi',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    const catiAfter = await SurveyResponse.countDocuments({
      survey: new mongoose.Types.ObjectId(SURVEY_ID),
      status: 'Pending_Approval',
      interviewMode: 'cati',
      reviewAssignment: { $exists: true },
      'reviewAssignment.assignedTo': { $ne: null },
      'reviewAssignment.expiresAt': { $gte: now }
    });

    console.log('✅ Verification:');
    console.log(`   CAPI active assignments remaining: ${capiAfter}`);
    console.log(`   CATI active assignments remaining: ${catiAfter}\n`);

    await mongoose.disconnect();
    console.log('✅ All review assignments cleared successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

clearReviewAssignments();


