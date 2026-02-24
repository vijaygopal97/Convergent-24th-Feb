/**
 * Investigate CAPI responses with non-S3 audio URLs
 * Find what URLs they have, group by pattern, and check if files exist locally
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const fs = require('fs');
const path = require('path');

async function investigateNonS3AudioUrls() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Investigating Non-S3 Audio URLs');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Find CAPI responses with audio URLs that are NOT in S3 format
    const capiResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $exists: true, $ne: null }
    })
      .select('_id audioRecording.audioUrl audioRecording.hasAudio audioRecording.fileSize audioRecording.uploadedAt audioRecording.recordingDuration')
      .read('secondaryPreferred')
      .maxTimeMS(120000)
      .lean();

    console.log(`📊 Found ${capiResponses.length} CAPI responses with audio URLs\n`);

    // Filter to only those that don't match S3 pattern
    const nonS3Responses = capiResponses.filter(response => {
      const audioUrl = response.audioRecording?.audioUrl;
      if (!audioUrl || typeof audioUrl !== 'string') return false;
      return !audioUrl.match(/^audio\/interviews\//);
    });

    console.log(`📊 Found ${nonS3Responses.length} responses with non-S3 audio URLs\n`);

    // Group by URL pattern
    const urlPatterns = {};
    const localFileChecks = [];

    for (const response of nonS3Responses) {
      const audioUrl = response.audioRecording?.audioUrl;
      if (!audioUrl) continue;

      // Categorize the URL
      let pattern = 'unknown';
      let category = 'unknown';

      if (audioUrl.startsWith('/uploads/audio/')) {
        pattern = 'local_path';
        category = 'Local file path (/uploads/audio/)';
      } else if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
        pattern = 'http_url';
        category = 'HTTP/HTTPS URL';
      } else if (audioUrl.startsWith('audio/')) {
        pattern = 'audio_no_interviews';
        category = 'audio/ but not audio/interviews/';
      } else if (audioUrl.startsWith('mock://')) {
        pattern = 'mock_url';
        category = 'Mock URL (mock://)';
      } else if (audioUrl.includes('s3.amazonaws.com')) {
        pattern = 's3_full_url';
        category = 'Full S3 URL (s3.amazonaws.com)';
      } else if (audioUrl.trim() === '' || audioUrl === 'null' || audioUrl === 'undefined') {
        pattern = 'empty_or_null';
        category = 'Empty or null string';
      } else {
        pattern = 'other';
        category = `Other format: ${audioUrl.substring(0, 50)}...`;
      }

      if (!urlPatterns[pattern]) {
        urlPatterns[pattern] = {
          category: category,
          count: 0,
          sampleUrls: [],
          sampleResponseIds: [],
          fileExists: [],
          fileNotExists: []
        };
      }

      urlPatterns[pattern].count++;
      
      // Keep up to 5 sample URLs per pattern
      if (urlPatterns[pattern].sampleUrls.length < 5) {
        urlPatterns[pattern].sampleUrls.push(audioUrl);
        urlPatterns[pattern].sampleResponseIds.push(response._id.toString());
      }

      // Check if local file exists (for /uploads/audio/ paths)
      if (audioUrl.startsWith('/uploads/audio/')) {
        const fullPath = path.join(__dirname, '../../', audioUrl);
        const exists = fs.existsSync(fullPath);
        if (exists) {
          urlPatterns[pattern].fileExists.push({
            responseId: response._id.toString(),
            url: audioUrl,
            path: fullPath
          });
        } else {
          urlPatterns[pattern].fileNotExists.push({
            responseId: response._id.toString(),
            url: audioUrl,
            path: fullPath
          });
        }
      }
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 URL Pattern Analysis');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const [pattern, data] of Object.entries(urlPatterns)) {
      console.log(`📁 ${data.category}`);
      console.log(`   Count: ${data.count}`);
      console.log(`   Sample Response IDs (first 5):`);
      data.sampleResponseIds.forEach((id, idx) => {
        console.log(`   ${idx + 1}. ${id} - ${data.sampleUrls[idx]}`);
      });

      // For local files, show existence status
      if (pattern === 'local_path') {
        console.log(`\n   Local File Status:`);
        console.log(`   ├─ Files that EXIST: ${data.fileExists.length}`);
        if (data.fileExists.length > 0 && data.fileExists.length <= 3) {
          data.fileExists.forEach(f => {
            console.log(`   │  └─ ${f.responseId}: ${f.url}`);
          });
        }
        console.log(`   └─ Files that DON'T EXIST: ${data.fileNotExists.length}`);
        if (data.fileNotExists.length > 0 && data.fileNotExists.length <= 3) {
          data.fileNotExists.forEach(f => {
            console.log(`      └─ ${f.responseId}: ${f.url}`);
          });
        }
      }

      console.log('');
    }

    // Summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Summary');
    console.log('═══════════════════════════════════════════════════════════\n');

    const totalNonS3 = nonS3Responses.length;
    console.log(`Total Non-S3 URLs: ${totalNonS3}\n`);

    // Check recovery potential
    const recoverableLocal = urlPatterns['local_path']?.fileExists.length || 0;
    const unrecoverableLocal = urlPatterns['local_path']?.fileNotExists.length || 0;
    const httpUrls = urlPatterns['http_url']?.count || 0;
    const s3FullUrls = urlPatterns['s3_full_url']?.count || 0;

    console.log('Recovery Potential:');
    console.log(`   ✅ Local files that EXIST (can be uploaded to S3): ${recoverableLocal}`);
    console.log(`   ❌ Local files that DON'T EXIST: ${unrecoverableLocal}`);
    console.log(`   🔗 HTTP/HTTPS URLs (may be accessible): ${httpUrls}`);
    console.log(`   ☁️  Full S3 URLs (may need conversion to key format): ${s3FullUrls}\n`);

    // Export sample response IDs for detailed inspection
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📝 Sample Response IDs for Inspection');
    console.log('═══════════════════════════════════════════════════════════\n');

    const allSampleIds = [];
    for (const [pattern, data] of Object.entries(urlPatterns)) {
      if (data.sampleResponseIds.length > 0) {
        console.log(`${data.category}:`);
        console.log(`   ${data.sampleResponseIds.join(', ')}\n`);
        allSampleIds.push(...data.sampleResponseIds);
      }
    }

    await mongoose.disconnect();
    console.log('✅ Investigation complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

investigateNonS3AudioUrls();






