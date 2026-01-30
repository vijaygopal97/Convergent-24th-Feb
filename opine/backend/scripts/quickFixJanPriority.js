/**
 * Quick Fix: Update AvailableAssignment priority for Jan 1-15 CAPI responses
 * 
 * This script directly updates the materialized view without changing code.
 * Safe to run - only updates priority field for specific date range.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const AvailableAssignment = require('../models/AvailableAssignment');

async function quickFixJanPriority() {
  try {
    console.log('🚀 Starting quick fix for Jan 1-15 priority...');
    
    // Connect to MongoDB
    if (mongoose.connection.readyState !== 1) {
      const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
      }
      await mongoose.connect(mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('✅ Connected to MongoDB');
    }
    
    // IST = UTC+5:30
    // If startTime is stored in UTC in MongoDB, and we want IST Jan 1-15:
    // IST Jan 1, YYYY 00:00:00 = UTC Dec 31, YYYY-1 18:30:00
    // IST Jan 15, YYYY 23:59:59 = UTC Jan 15, YYYY 18:29:59
    const nowYear = new Date().getFullYear();
    const prevYear = nowYear - 1;
    
    // Create UTC dates directly (MongoDB stores dates in UTC)
    // Jan 1, YYYY 00:00:00 IST = Dec 31, YYYY-1 18:30:00 UTC
    const windowStart = new Date(`${prevYear}-12-31T18:30:00.000Z`);
    // Jan 15, YYYY 23:59:59 IST = Jan 15, YYYY 18:29:59 UTC
    const windowEnd = new Date(`${nowYear}-01-15T18:29:59.999Z`);
    
    console.log(`📅 Date window (IST): Jan 1, ${nowYear} 00:00:00 IST to Jan 15, ${nowYear} 23:59:59 IST`);
    console.log(`📅 Date window (UTC): ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);
    
    // Find CAPI responses in Pending_Approval with startTime in the window
    // Also check startedAt as fallback
    const query = {
      status: 'Pending_Approval',
      interviewMode: 'capi',
      $or: [
        { startTime: { $gte: windowStart, $lte: windowEnd } },
        { startedAt: { $gte: windowStart, $lte: windowEnd } }
      ],
      // Only include responses that would pass QC filters
      'audioRecording.hasAudio': true,
      'audioRecording.fileSize': { $exists: true, $gt: 0 },
      'audioRecording.uploadedAt': { $exists: true, $ne: null },
      'audioRecording.audioUrl': { $exists: true, $type: 'string', $regex: /^audio\/interviews\// },
      'audioRecording.recordingDuration': { $exists: true, $gt: 0 },
      'responses.2': { $exists: true } // At least 3 responses
    };
    
    console.log('🔍 Finding eligible CAPI responses...');
    const responses = await SurveyResponse.find(query)
      .select('_id startTime startedAt createdAt survey interviewer selectedAC interviewMode lastSkippedAt')
      .read('secondaryPreferred')
      .maxTimeMS(30000)
      .lean();
    
    console.log(`📊 Found ${responses.length} eligible CAPI responses`);
    
    if (responses.length === 0) {
      console.log('✅ No responses to update. Exiting.');
      await mongoose.connection.close();
      return;
    }
    
    // Update AvailableAssignment entries
    const bulkOps = [];
    let updated = 0;
    let created = 0;
    
    for (const response of responses) {
      const surveyId = response.survey?.toString() || response.survey;
      const interviewerId = response.interviewer?.toString() || response.interviewer;
      const selectedAC = response.selectedAC || null;
      const startTime = response.startTime || response.startedAt || response.createdAt || new Date();
      
      // Check if entry exists
      const existing = await AvailableAssignment.findOne({ responseId: response._id }).lean();
      
      if (existing) {
        // Update existing entry
        bulkOps.push({
          updateOne: {
            filter: { responseId: response._id },
            update: {
              $set: {
                priority: 0, // Highest priority
                updatedAt: new Date()
              }
            }
          }
        });
        updated++;
      } else {
        // Create new entry
        bulkOps.push({
          updateOne: {
            filter: { responseId: response._id },
            update: {
              $set: {
                responseId: response._id,
                surveyId: new mongoose.Types.ObjectId(surveyId),
                interviewerId: interviewerId ? new mongoose.Types.ObjectId(interviewerId) : null,
                status: 'available',
                interviewMode: 'capi',
                selectedAC: selectedAC,
                priority: 0, // Highest priority
                lastSkippedAt: response.lastSkippedAt || null,
                createdAt: startTime,
                updatedAt: new Date()
              }
            },
            upsert: true
          }
        });
        created++;
      }
      
      // Execute in batches to prevent memory issues
      if (bulkOps.length >= 200) {
        await AvailableAssignment.bulkWrite(bulkOps, { ordered: false });
        bulkOps.length = 0;
      }
    }
    
    // Execute remaining operations
    if (bulkOps.length > 0) {
      await AvailableAssignment.bulkWrite(bulkOps, { ordered: false });
    }
    
    console.log(`✅ Quick fix completed:`);
    console.log(`   - Updated ${updated} existing entries`);
    console.log(`   - Created ${created} new entries`);
    console.log(`   - Total: ${updated + created} entries with priority 0`);

    // Demote pre-window responses so they don't outrank Jan 1-15
    console.log('🔻 Demoting pre-window responses to lower priority (5)...');
    const preWindowAgg = await AvailableAssignment.aggregate([
      { $match: { interviewMode: 'capi', status: 'available' } },
      {
        $lookup: {
          from: 'surveyresponses',
          localField: 'responseId',
          foreignField: '_id',
          as: 'resp'
        }
      },
      { $unwind: '$resp' },
      {
        $match: {
          $or: [
            { 'resp.startTime': { $lt: windowStart } },
            { 'resp.startedAt': { $lt: windowStart } }
          ]
        }
      },
      { $project: { responseId: 1 } }
    ]);

    if (preWindowAgg.length > 0) {
      const bulkDemote = preWindowAgg.map(doc => ({
        updateOne: {
          filter: { responseId: doc.responseId },
          update: { $set: { priority: 5, updatedAt: new Date() } }
        }
      }));
      await AvailableAssignment.bulkWrite(bulkDemote, { ordered: false });
      console.log(`   - Demoted ${preWindowAgg.length} pre-window entries to priority 5`);
    } else {
      console.log('   - No pre-window entries to demote');
    }
    
    await mongoose.connection.close();
    console.log('✅ Done!');
    
  } catch (error) {
    console.error('❌ Error in quickFixJanPriority:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  quickFixJanPriority()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = quickFixJanPriority;

