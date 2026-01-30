/**
 * Push all playable CAPI Pending_Approval responses (all time)
 * into AvailableAssignment with highest priority (0).
 *
 * Ordering is preserved via createdAt in the materialized view
 * using startTime > startedAt > createdAt from SurveyResponse.
 *
 * Safe to run multiple times; uses upserts.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const AvailableAssignment = require('../models/AvailableAssignment');

const BATCH_SIZE = 200;

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI or MONGO_URI not found');
  }

  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  console.log('✅ Connected to MongoDB');

  const query = {
    status: 'Pending_Approval',
    interviewMode: 'capi',
    'audioRecording.hasAudio': true,
    'audioRecording.fileSize': { $exists: true, $gt: 0 },
    'audioRecording.uploadedAt': { $exists: true, $ne: null },
    'audioRecording.audioUrl': { $exists: true, $type: 'string', $regex: /^audio\/interviews\// },
    'audioRecording.recordingDuration': { $exists: true, $gt: 0 },
    'responses.2': { $exists: true }
  };

  const total = await SurveyResponse.countDocuments(query);
  console.log(`📊 Playable CAPI responses (all time): ${total}`);

  const cursor = SurveyResponse.find(query)
    .select('_id survey interviewer interviewMode selectedAC startTime startedAt createdAt lastSkippedAt')
    .sort({ startTime: 1, createdAt: 1 })
    .lean()
    .cursor();

  let bulk = [];
  let processed = 0;

  for await (const response of cursor) {
    const surveyId = response.survey?.toString() || response.survey;
    const interviewerId = response.interviewer?.toString() || response.interviewer;
    const startTime = response.startTime || response.startedAt || response.createdAt || new Date();

    bulk.push({
      updateOne: {
        filter: { responseId: response._id },
        update: {
          $set: {
            responseId: response._id,
            surveyId: new mongoose.Types.ObjectId(surveyId),
            interviewerId: interviewerId ? new mongoose.Types.ObjectId(interviewerId) : null,
            status: 'available',
            interviewMode: 'capi',
            selectedAC: response.selectedAC || null,
            priority: 0,
            lastSkippedAt: null,
            createdAt: startTime,
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    });

    if (bulk.length >= BATCH_SIZE) {
      await AvailableAssignment.bulkWrite(bulk, { ordered: false });
      bulk = [];
    }
    processed += 1;
    if (processed % 500 === 0) {
      console.log(`...processed ${processed}/${total}`);
    }
  }

  if (bulk.length) {
    await AvailableAssignment.bulkWrite(bulk, { ordered: false });
  }

  console.log(`✅ Completed. Upserted/updated ${processed} entries at priority 0`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch(async (err) => {
    console.error('❌ Error:', err);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  });
}

module.exports = run;

