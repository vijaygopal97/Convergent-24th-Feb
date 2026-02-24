/**
 * Apply rejection reasons from autoRejectionReasons and feedback
 * - Short duration (auto rule on duration)
 * - Duplicate phone number (auto duplicate detection)
 * - Fraud interview (manual / feedback-based)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

async function applyAutoRejectionReasons() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Applying Auto Rejection Reasons');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Find all rejected responses
    const rejectedResponses = await SurveyResponse.find({
      status: 'Rejected'
    })
      .select('_id responseId status verificationData')
      .read('secondaryPreferred')
      .maxTimeMS(300000)
      .lean();

    console.log(`📊 Total Rejected Responses: ${rejectedResponses.length}\n`);

    const stats = {
      shortDuration: 0,
      duplicatePhone: 0,
      fraudInterview: 0,
      gpsDistance: 0,
      alreadyCorrect: 0,
      updated: 0,
      skipped: 0
    };

    const updates = [];

    for (const response of rejectedResponses) {
      const verificationData = response.verificationData || {};
      const autoRejectionReasons = verificationData.autoRejectionReasons || [];
      const feedback = verificationData.feedback || '';
      const feedbackLower = feedback.toLowerCase();

      // Determine rejection reason from autoRejectionReasons and feedback
      let rejectionReason = null;
      let reasonType = null;

      // Priority 1: Check autoRejectionReasons
      if (autoRejectionReasons.length > 0) {
        if (autoRejectionReasons.includes('duration')) {
          rejectionReason = 'Short Duration';
          reasonType = 'shortDuration';
        } else if (autoRejectionReasons.includes('duplicate_phone')) {
          rejectionReason = 'Duplicate Phone Number';
          reasonType = 'duplicatePhone';
        } else if (autoRejectionReasons.includes('gps_distance')) {
          rejectionReason = 'GPS Distance Too Far';
          reasonType = 'gpsDistance';
        }
      }

      // Priority 2: Check feedback for fraud interview
      if (!rejectionReason && feedback) {
        if (feedbackLower.includes('fraud') || 
            feedbackLower.includes('fraudulent') ||
            feedbackLower.includes('fraud interview')) {
          rejectionReason = 'Fraud Interview';
          reasonType = 'fraudInterview';
        }
      }

      // Priority 3: Check feedback for short duration
      if (!rejectionReason && feedback) {
        if (feedbackLower.includes('interview too short') || 
            feedbackLower.includes('too short') ||
            feedbackLower.includes('short duration') ||
            feedbackLower.includes('duration too short')) {
          rejectionReason = 'Short Duration';
          reasonType = 'shortDuration';
        }
      }

      // Priority 4: Check feedback for duplicate phone
      if (!rejectionReason && feedback) {
        if (feedbackLower.includes('duplicate phone') ||
            feedbackLower.includes('duplicate phone number') ||
            feedbackLower.includes('phone number already used')) {
          rejectionReason = 'Duplicate Phone Number';
          reasonType = 'duplicatePhone';
        }
      }

      // Priority 5: Check feedback for GPS distance
      if (!rejectionReason && feedback) {
        if (feedbackLower.includes('gps location too far') ||
            (feedbackLower.includes('gps') && feedbackLower.includes('far')) ||
            feedbackLower.includes('location too far') ||
            feedbackLower.includes('gps distance') ||
            feedbackLower.includes('distance too far')) {
          rejectionReason = 'GPS Distance Too Far';
          reasonType = 'gpsDistance';
        }
      }

      // If we found a reason, check if it needs to be updated
      if (rejectionReason) {
        stats[reasonType]++;

        // Check if feedback already matches
        const currentFeedback = feedback || '';
        const needsUpdate = currentFeedback !== rejectionReason;

        if (needsUpdate) {
          updates.push({
            updateOne: {
              filter: { _id: response._id },
              update: {
                $set: {
                  'verificationData.feedback': rejectionReason,
                  'metadata.rejectionReason': rejectionReason,
                  'metadata.manualRejectionReason': rejectionReason,
                  'updatedAt': new Date()
                }
              }
            }
          });
          stats.updated++;
        } else {
          stats.alreadyCorrect++;
        }
      } else {
        stats.skipped++;
      }
    }

    // Execute bulk updates
    if (updates.length > 0) {
      console.log(`\n📝 Applying ${updates.length} updates...`);
      const batchSize = 1000;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const result = await SurveyResponse.bulkWrite(batch, { ordered: false });
        console.log(`   Batch ${Math.floor(i / batchSize) + 1}: Updated ${result.modifiedCount} responses`);
      }
    }

    // Display summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 Update Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Rejection Reasons Found:');
    console.log(`   Short Duration: ${stats.shortDuration}`);
    console.log(`   Duplicate Phone Number: ${stats.duplicatePhone}`);
    console.log(`   Fraud Interview: ${stats.fraudInterview}`);
    console.log(`   GPS Distance Too Far: ${stats.gpsDistance}`);
    console.log(`\n   Total with reasons: ${stats.shortDuration + stats.duplicatePhone + stats.fraudInterview + stats.gpsDistance}`);
    console.log(`   Skipped (no auto reason found): ${stats.skipped}\n`);

    console.log('Update Status:');
    console.log(`   Updated: ${stats.updated}`);
    console.log(`   Already correct: ${stats.alreadyCorrect}`);
    console.log(`   Total processed: ${rejectedResponses.length}\n`);

    await mongoose.disconnect();
    console.log('✅ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

applyAutoRejectionReasons();





