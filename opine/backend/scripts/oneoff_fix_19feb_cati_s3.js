#!/usr/bin/env node
/**
 * One-off: Fix CATI calls from 19 Feb that have recording URL but were not uploaded to S3,
 * only for responses that are in Pending_Approval status.
 * Only touches CatiCall documents; uses Referer in this script only for download.
 *
 * Usage: node scripts/oneoff_fix_19feb_cati_s3.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');
const CatiCall = require('../models/CatiCall');
const SurveyResponse = require('../models/SurveyResponse');
const { uploadBufferToS3 } = require('../utils/cloudStorage');

const DRY_RUN = process.argv.includes('--dry-run');

const FEB19_START = new Date('2026-02-19T00:00:00.000Z');
const FEB19_END   = new Date('2026-02-20T00:00:00.000Z');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const callQuery = {
    $and: [
      { recordingUrl: { $exists: true, $type: 'string', $regex: /^https?:\/\//i } },
      {
        $or: [
          { webhookReceivedAt: { $gte: FEB19_START, $lt: FEB19_END } },
          { createdAt: { $gte: FEB19_START, $lt: FEB19_END } }
        ]
      },
      {
        $or: [
          { s3AudioUploadStatus: { $ne: 'uploaded' } },
          { s3AudioUploadStatus: { $exists: false } },
          { s3AudioUrl: { $exists: false } },
          { s3AudioUrl: null }
        ]
      }
    ]
  };

  const allCalls = await CatiCall.find(callQuery)
    .select('_id callId recordingUrl')
    .lean();

  const callIds = allCalls.map(c => String(c.callId));
  const pendingCallIds = await SurveyResponse.distinct('call_id', {
    status: 'Pending_Approval',
    call_id: { $in: callIds, $exists: true, $ne: null, $ne: '' }
  });
  const pendingSet = new Set(pendingCallIds.map(id => String(id).trim()));

  const calls = allCalls.filter(c => pendingSet.has(String(c.callId).trim()));
  console.log(`19 Feb: ${calls.length} CATI call(s) with recording URL, no S3, and response in Pending_Approval. Dry run: ${DRY_RUN}\n`);

  let ok = 0, fail = 0;
  for (const call of calls) {
    const url = call.recordingUrl;
    if (!url || !url.startsWith('http')) { fail++; continue; }

    if (DRY_RUN) {
      console.log(`[dry-run] ${call.callId} ${url.substring(0, 60)}...`);
      ok++;
      continue;
    }

    let buffer;
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'audio/*,*/*;q=0.8',
          'Referer': 'https://callrecords.rpdigitalphone.com/'
        },
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 100 * 1024 * 1024
      });
      buffer = Buffer.from(res.data);
    } catch (e) {
      console.log(`Skip ${call.callId}: download failed (${e.response?.status || e.message})`);
      fail++;
      continue;
    }

    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
    const s3Key = `audio/cati/${y}/${m}/${call.callId}_${now.getTime()}.mp3`;

    try {
      await uploadBufferToS3(buffer, s3Key, {
        contentType: 'audio/mpeg',
        metadata: { source: 'oneoff_19feb', callId: call.callId, originalUrl: url }
      });
      await CatiCall.updateOne(
        { _id: call._id },
        {
          $set: {
            s3AudioUrl: s3Key,
            s3AudioUploadedAt: now,
            s3AudioUploadStatus: 'uploaded',
            s3AudioUploadError: null
          }
        }
      );
      console.log(`OK ${call.callId} -> ${s3Key}`);
      ok++;
    } catch (e) {
      console.log(`Fail ${call.callId}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} uploaded, ${fail} failed/skipped.`);
  await mongoose.connection.close();
  process.exit(fail && !ok ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
