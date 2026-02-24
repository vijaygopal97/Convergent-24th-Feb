const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

const CSV_PATH = '/var/www/reports/TODAY.csv';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    dryRun: false,
    limit: null,
    reportPath: `/tmp/restore_rejection_reasons_from_today_${Date.now()}.jsonl`,
    batchSize: 1000
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--limit') out.limit = Number(args[++i]);
    else if (a === '--report') out.reportPath = args[++i];
    else if (a === '--batch-size') out.batchSize = Number(args[++i]);
  }
  return out;
}

function normalizeStatus(s) {
  return String(s || '').trim().toLowerCase();
}

function reasonCodeToFeedback(code) {
  const c = String(code || '').trim();
  switch (c) {
    case '1':
      return 'Interview Too Short';
    case '2':
      return 'GPS rejection';
    case '3':
      return 'Duplicate Response';
    case '4':
      return 'Audio quality did not meet standards';
    case '5':
      return 'Gender response did not match';
    case '6':
      return 'Previous assembly elections response did not match';
    case '7':
      return 'Previous Lok Sabha elections response did not match';
    case '8':
      return 'Upcoming elections response did not match';
    case '9':
      return 'Interviewer performance';
    default:
      return '';
  }
}

async function restoreReasons() {
  const { dryRun, limit, reportPath, batchSize } = parseArgs();

  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found at ${CSV_PATH}`);
  }

  console.log('📄 Input CSV:', CSV_PATH);
  console.log('📝 Report (jsonl):', reportPath);
  console.log('⚙️  Options:', { dryRun, limit, batchSize });

  const reportStream = fs.createWriteStream(reportPath, { flags: 'wx' });

  const responseIdToCode = new Map(); // responseId -> rejection_reason code (string)
  let parsedRows = 0;
  let parsedRejectedWithCode = 0;

  await new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(CSV_PATH);
    const parser = csvParser();

    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      if (err) reject(err);
      else resolve();
    };

    fileStream
      .pipe(parser)
      .on('data', (row) => {
        parsedRows++;
        if (limit && parsedRows > limit) {
          // Stop early and resolve cleanly (csv-parser does not emit 'end' on destroy)
          try { fileStream.destroy(); } catch (_) {}
          try { parser.end(); } catch (_) {}
          finish();
          return;
        }

        const responseId = (row['Response ID'] || row['ResponseId'] || row['responseId'] || row['response_id'] || '').toString().trim();
        const status = normalizeStatus(row['Status'] || row['status']);
        const codeRaw = (row['rejection_reason'] || row['Rejection Reason'] || row['rejectionReason'] || '').toString().trim();
        const code = codeRaw.replace(/[^0-9]/g, ''); // keep digits only

        if (!responseId) return;
        if (status !== 'rejected') return;
        if (!code) return;

        parsedRejectedWithCode++;
        if (!responseIdToCode.has(responseId)) {
          responseIdToCode.set(responseId, code);
        }
      })
      .on('error', finish)
      .on('end', () => finish());

    fileStream.on('error', finish);
    fileStream.on('close', () => {
      // If we closed early due to limit, finish() would have been called already.
      // If the file closes without 'end' (rare), still finish.
      if (!finished) finish();
    });
  });

  console.log(`✅ Parsed rows: ${parsedRows}`);
  console.log(`✅ Rejected rows with a rejection_reason code: ${parsedRejectedWithCode}`);
  console.log(`✅ Unique rejected responseIds with code: ${responseIdToCode.size}`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const responseIds = Array.from(responseIdToCode.keys());
  let updated = 0;
  let matchedManual = 0;
  let notFound = 0;
  let skippedNoManual = 0;
  let skippedUnknownCode = 0;

  for (let i = 0; i < responseIds.length; i += batchSize) {
    const batchIds = responseIds.slice(i, i + batchSize);

    const docs = await SurveyResponse.find({
      responseId: { $in: batchIds },
      status: 'Rejected',
      'verificationData.feedback': { $regex: /manual rejection/i }
    })
      .select('_id responseId status verificationData.feedback')
      .lean();

    const byResponseId = new Map(docs.map((d) => [d.responseId, d]));
    matchedManual += docs.length;

    const bulkOps = [];

    for (const rid of batchIds) {
      const doc = byResponseId.get(rid);
      if (!doc) {
        // Either not found, or not rejected, or feedback not manual — we count unknown vs skipped later
        continue;
      }

      const code = responseIdToCode.get(rid);
      const newFeedback = reasonCodeToFeedback(code);
      if (!newFeedback) {
        skippedUnknownCode++;
        continue;
      }

      const oldFeedback = doc?.verificationData?.feedback || '';
      if (!/manual rejection/i.test(oldFeedback)) {
        skippedNoManual++;
        continue;
      }

      // Report line (always)
      reportStream.write(
        JSON.stringify({
          responseId: rid,
          code: String(code),
          oldFeedback,
          newFeedback,
          updatedAt: new Date().toISOString()
        }) + '\n'
      );

      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { 'verificationData.feedback': newFeedback } }
          }
        });
      }
    }

    if (!dryRun && bulkOps.length > 0) {
      const res = await SurveyResponse.bulkWrite(bulkOps, { ordered: false });
      updated += (res.modifiedCount || 0);
    } else if (dryRun) {
      updated += bulkOps.length; // 0 in dryRun; keep semantics consistent
    }

    if ((i / batchSize) % 10 === 0) {
      console.log(`...processed ${Math.min(i + batchSize, responseIds.length)}/${responseIds.length}`);
    }
  }

  // Count "not found" roughly: those in CSV minus those matched in DB with manual feedback.
  // (Some may exist but not manual; we don't want to treat those as not found.)
  // We'll compute exact counts for transparency:
  const existingRejected = await SurveyResponse.countDocuments({
    responseId: { $in: responseIds },
    status: 'Rejected'
  });

  const existingRejectedManual = await SurveyResponse.countDocuments({
    responseId: { $in: responseIds },
    status: 'Rejected',
    'verificationData.feedback': { $regex: /manual rejection/i }
  });

  notFound = responseIds.length - existingRejected;

  reportStream.end();
  await mongoose.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 RESTORE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CSV unique rejected responseIds with code:', responseIdToCode.size);
  console.log('DB existing rejected among those ids:', existingRejected);
  console.log('DB rejected with manual feedback among those ids:', existingRejectedManual);
  console.log('Updated feedback count (bulk modifiedCount):', updated);
  console.log('Skipped (unknown code):', skippedUnknownCode);
  console.log('Skipped (feedback not manual):', skippedNoManual);
  console.log('Not found in DB (among ids):', notFound);
  console.log('Report:', reportPath);
  console.log('Dry run:', dryRun);
  console.log('═══════════════════════════════════════════════════════════\n');
}

restoreReasons().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});


