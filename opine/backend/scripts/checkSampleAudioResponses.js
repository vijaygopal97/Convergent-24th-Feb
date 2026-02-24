/**
 * Check sample response IDs to see their full audioRecording structure
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const SAMPLE_IDS = [
  '695f911d1b84564ebe339ca9',  // Local path
  '695fe8111aef4dea069a5daf',  // Local path
  '6964a1c9a0db05a1b3e9f1ec',  // Local path that EXISTS
  '693c0349adddc0dbfe17c0c5'   // Mock URL
];

async function checkSampleResponses() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Sample Response Details');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const responseId of SAMPLE_IDS) {
      const response = await SurveyResponse.findById(responseId)
        .select('_id status interviewMode audioRecording startTime createdAt')
        .lean();

      if (!response) {
        console.log(`❌ Response ${responseId} not found\n`);
        continue;
      }

      console.log(`📄 Response ID: ${responseId}`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Interview Mode: ${response.interviewMode}`);
      console.log(`   Created At: ${response.createdAt}`);
      console.log(`   Start Time: ${response.startTime}`);
      console.log(`   Audio Recording:`);
      
      if (response.audioRecording) {
        console.log(`      hasAudio: ${response.audioRecording.hasAudio}`);
        console.log(`      fileSize: ${response.audioRecording.fileSize}`);
        console.log(`      uploadedAt: ${response.audioRecording.uploadedAt}`);
        console.log(`      recordingDuration: ${response.audioRecording.recordingDuration}`);
        console.log(`      audioUrl: ${response.audioRecording.audioUrl}`);
        if (response.audioRecording.s3Key) {
          console.log(`      s3Key: ${response.audioRecording.s3Key}`);
        }
        if (response.audioRecording.originalUrl) {
          console.log(`      originalUrl: ${response.audioRecording.originalUrl}`);
        }
      } else {
        console.log(`      (no audioRecording object)`);
      }
      console.log('');
    }

    await mongoose.disconnect();
    console.log('✅ Check complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

checkSampleResponses();






