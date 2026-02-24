/**
 * Check if responses with local URLs have S3 keys or were uploaded to S3
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

async function checkS3Keys() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Checking S3 Keys for Local URL Responses');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Find CAPI responses with local URLs
    const localUrlResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $regex: /^\/uploads\/audio\// }
    })
      .select('_id audioRecording.audioUrl audioRecording.s3Key audioRecording.originalUrl audioRecording.hasAudio audioRecording.fileSize audioRecording.uploadedAt')
      .read('secondaryPreferred')
      .maxTimeMS(120000)
      .limit(100) // Sample first 100
      .lean();

    console.log(`📊 Checking ${localUrlResponses.length} responses with local URLs...\n`);

    let withS3Key = 0;
    let withOriginalUrl = 0;
    let withoutS3Info = 0;
    const samples = {
      withS3Key: [],
      withOriginalUrl: [],
      withoutS3Info: []
    };

    for (const response of localUrlResponses) {
      const audioRec = response.audioRecording;
      if (!audioRec) continue;

      if (audioRec.s3Key) {
        withS3Key++;
        if (samples.withS3Key.length < 5) {
          samples.withS3Key.push({
            responseId: response._id.toString(),
            audioUrl: audioRec.audioUrl,
            s3Key: audioRec.s3Key
          });
        }
      } else if (audioRec.originalUrl) {
        withOriginalUrl++;
        if (samples.withOriginalUrl.length < 5) {
          samples.withOriginalUrl.push({
            responseId: response._id.toString(),
            audioUrl: audioRec.audioUrl,
            originalUrl: audioRec.originalUrl
          });
        }
      } else {
        withoutS3Info++;
        if (samples.withoutS3Info.length < 5) {
          samples.withoutS3Info.push({
            responseId: response._id.toString(),
            audioUrl: audioRec.audioUrl
          });
        }
      }
    }

    console.log('📊 Results (sample of 100):');
    console.log(`   With S3 Key: ${withS3Key}`);
    console.log(`   With Original URL: ${withOriginalUrl}`);
    console.log(`   Without S3 Info: ${withoutS3Info}\n`);

    if (samples.withS3Key.length > 0) {
      console.log('✅ Responses with S3 Keys (can be recovered):');
      samples.withS3Key.forEach(s => {
        console.log(`   ${s.responseId}: s3Key="${s.s3Key}"`);
      });
      console.log('');
    }

    if (samples.withOriginalUrl.length > 0) {
      console.log('🔗 Responses with Original URLs:');
      samples.withOriginalUrl.forEach(s => {
        console.log(`   ${s.responseId}: originalUrl="${s.originalUrl}"`);
      });
      console.log('');
    }

    if (samples.withoutS3Info.length > 0) {
      console.log('❌ Responses without S3 Info (local files only):');
      samples.withoutS3Info.forEach(s => {
        console.log(`   ${s.responseId}: ${s.audioUrl}`);
      });
      console.log('');
    }

    // Check full count
    const totalWithLocalUrls = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $regex: /^\/uploads\/audio\// }
    });

    const totalWithS3Key = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      'audioRecording.audioUrl': { $regex: /^\/uploads\/audio\// },
      'audioRecording.s3Key': { $exists: true, $ne: null }
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Full Count');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Total with local URLs: ${totalWithLocalUrls}`);
    console.log(`   With S3 Key (potentially recoverable): ${totalWithS3Key}`);
    console.log(`   Without S3 Key (likely unrecoverable): ${totalWithLocalUrls - totalWithS3Key}\n`);

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

checkS3Keys();






