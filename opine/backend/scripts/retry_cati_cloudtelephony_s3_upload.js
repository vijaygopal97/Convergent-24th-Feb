#!/usr/bin/env node

/**
 * Retry CATI Cloud Telephony recording download and S3 upload
 *
 * On 19 Feb and nearby days, many CATI responses received a recording URL from
 * Cloud Telephony in the webhook, but the URL was not accessible at that time,
 * so the background download/S3 upload failed. This script finds those calls
 * (in the last 10 days), retries downloading from the recording URL and
 * uploads to S3 using the same process as the webhook, without affecting
 * anything else.
 *
 * Criteria:
 * - CatiCall in last 10 days
 * - recordingUrl present (http)
 * - S3 upload not successful (s3AudioUploadStatus !== 'uploaded' or no s3AudioUrl)
 *
 * Optionally include a specific responseId (e.g. 1aa32f94-3848-4957-b36f-64bd69031945)
 * so that response's call is always processed if it matches the above.
 *
 * Usage:
 *   node scripts/retry_cati_cloudtelephony_s3_upload.js [--dry-run] [--response-id=UUID] [--max=N]
 *
 * Note: If the provider returns 403 for recording URLs (e.g. callrecords.rpdigitalphone.com),
 * you may need to confirm with Cloud Telephony whether recordings are downloadable from
 * their CDN or require a different URL/auth. The script uses the same download+upload
 * logic as the webhook (including optional Basic auth when source is cloudtelephony).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const CatiCall = require('../models/CatiCall');
const SurveyResponse = require('../models/SurveyResponse');
const { downloadAndUploadCatiAudio } = require('../utils/cloudStorage');

const DRY_RUN = process.argv.includes('--dry-run');
const RESPONSE_ID_ARG = process.argv.find(a => a.startsWith('--response-id='));
const SPECIFIC_RESPONSE_ID = RESPONSE_ID_ARG ? RESPONSE_ID_ARG.split('=')[1].trim() : null;
const MAX_ARG = process.argv.find(a => a.startsWith('--max='));
const MAX_CALLS = MAX_ARG ? parseInt(MAX_ARG.split('=')[1], 10) : null;

const DAYS_AGO = 10;

function isCloudTelephonyUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname || '';
    return host.includes('indiavoice') || host.includes('rpdigitalphone');
  } catch (_) {
    return false;
  }
}

function getUploadOptions(recordingUrl) {
  return isCloudTelephonyUrl(recordingUrl)
    ? { source: 'cloudtelephony' }
    : {};
}

async function main() {
  try {
    console.log('='.repeat(70));
    console.log('RETRY CATI CLOUD TELEPHONY RECORDING → S3 UPLOAD');
    console.log('='.repeat(70));
    console.log(`Last ${DAYS_AGO} days; Dry run: ${DRY_RUN}; Max calls: ${MAX_CALLS != null ? MAX_CALLS : 'all'}`);
    if (SPECIFIC_RESPONSE_ID) {
      console.log(`Include responseId: ${SPECIFIC_RESPONSE_ID}`);
    }
    console.log('='.repeat(70));

    const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI or MONGO_URI required');
    }
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const since = new Date();
    since.setDate(since.getDate() - DAYS_AGO);
    since.setHours(0, 0, 0, 0);

    const query = {
      $and: [
        { recordingUrl: { $exists: true, $type: 'string', $regex: /^https?:\/\//i } },
        {
          $or: [
            { s3AudioUploadStatus: { $ne: 'uploaded' } },
            { s3AudioUploadStatus: { $exists: false } },
            { s3AudioUrl: { $exists: false } },
            { s3AudioUrl: null }
          ]
        },
        { $or: [{ createdAt: { $gte: since } }, { webhookReceivedAt: { $gte: since } }] }
      ]
    };

    // Sort by recordingUrl so paths like .../14/... (accessible) come before .../19/... (some 403)
    let calls = await CatiCall.find(query)
      .select('_id callId recordingUrl s3AudioUrl s3AudioUploadStatus s3AudioUploadError createdAt webhookReceivedAt metadata')
      .sort({ recordingUrl: 1 })
      .lean();

    const callIdsFromResponse = new Set();
    if (SPECIFIC_RESPONSE_ID) {
      const response = await SurveyResponse.findOne(
        { responseId: SPECIFIC_RESPONSE_ID },
        { call_id: 1, responseId: 1 }
      ).lean();
      if (response && response.call_id) {
        callIdsFromResponse.add(String(response.call_id).trim());
        console.log(`✅ Found response ${SPECIFIC_RESPONSE_ID} → call_id: ${response.call_id}\n`);
        const alreadyInList = calls.some(c => String(c.callId) === String(response.call_id));
        if (!alreadyInList) {
          const extraCall = await CatiCall.findOne(
            { callId: response.call_id },
            '_id callId recordingUrl s3AudioUrl s3AudioUploadStatus s3AudioUploadError createdAt webhookReceivedAt metadata'
          ).lean();
          if (extraCall) {
            calls = [extraCall, ...calls];
            console.log(`   Prepended call from response so it is processed first: ${extraCall.callId}\n`);
          } else {
            console.warn(`   ⚠️ No CatiCall found for call_id: ${response.call_id}\n`);
          }
        } else {
          // Move the specific response's call to the front so it is processed first
          const idx = calls.findIndex(c => String(c.callId) === String(response.call_id));
          if (idx > 0) {
            const [specific] = calls.splice(idx, 1);
            calls = [specific, ...calls];
            console.log(`   Moved call ${response.call_id} to front of list so it is processed first.\n`);
          }
        }
      } else {
        console.warn(`   ⚠️ Response ${SPECIFIC_RESPONSE_ID} not found or has no call_id\n`);
      }
    }

    if (MAX_CALLS != null && MAX_CALLS > 0) {
      calls = calls.slice(0, MAX_CALLS);
    }
    const total = calls.length;
    console.log(`📋 Will process ${total} CATI call(s) (recording URL present, S3 not uploaded)\n`);
    if (total === 0) {
      await mongoose.connection.close();
      process.exit(0);
    }

    const results = { success: 0, failed: 0, deleted: 0, errors: [] };

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const oneBased = i + 1;
      console.log(`\n[${oneBased}/${total}] callId: ${call.callId}`);

      if (!call.recordingUrl || !call.recordingUrl.startsWith('http')) {
        console.log('   ⏭️  No valid recording URL, skip');
        continue;
      }

      if (DRY_RUN) {
        console.log(`   [DRY RUN] Would retry: ${call.recordingUrl.substring(0, 70)}...`);
        results.success++;
        continue;
      }

      try {
        await CatiCall.updateOne(
          { _id: call._id },
          { $set: { s3AudioUploadStatus: 'pending', s3AudioUploadError: null } }
        );

        const opts = getUploadOptions(call.recordingUrl);
        const uploadResult = await downloadAndUploadCatiAudio(
          call.recordingUrl,
          call.callId,
          opts
        );

        await CatiCall.updateOne(
          { _id: call._id },
          {
            $set: {
              s3AudioUrl: uploadResult.s3Key,
              s3AudioUploadedAt: new Date(),
              s3AudioUploadStatus: 'uploaded',
              s3AudioUploadError: null
            }
          }
        );

        results.success++;
        console.log(`   ✅ Uploaded to S3: ${uploadResult.s3Key}`);
      } catch (err) {
        const msg = err.message || String(err);
        results.failed++;
        results.errors.push({ callId: call.callId, error: msg });

        if (msg === 'RECORDING_DELETED' || (err.response && err.response.status === 404)) {
          results.deleted++;
          console.log('   🗑️  Recording no longer available (404/deleted)');
          await CatiCall.updateOne(
            { _id: call._id },
            {
              $set: {
                s3AudioUploadStatus: 'deleted',
                s3AudioUploadError: 'Recording no longer available at provider'
              }
            }
          ).catch(() => {});
        } else {
          console.error(`   ❌ ${msg}`);
          await CatiCall.updateOne(
            { _id: call._id },
            {
              $set: {
                s3AudioUploadStatus: 'failed',
                s3AudioUploadError: msg.substring(0, 500)
              }
            }
          ).catch(() => {});
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('DONE');
    console.log('='.repeat(70));
    console.log(`✅ Uploaded: ${results.success}`);
    console.log(`❌ Failed: ${results.failed} (of which deleted/unavailable: ${results.deleted})`);
    if (results.errors.length) {
      console.log('\nErrors:');
      results.errors.slice(0, 20).forEach(e => console.log(`  ${e.callId}: ${e.error}`));
      if (results.errors.length > 20) {
        console.log(`  ... and ${results.errors.length - 20} more`);
      }
    }
    console.log('='.repeat(70));

    await mongoose.connection.close();
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n❌ Fatal:', err.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();
