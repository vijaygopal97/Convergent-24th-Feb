/**
 * Fix rejection reasons for specific response sets based on CSV reports.
 *
 * 1) /var/www/opine/backend/reports/reject-fraud-interviews-report-2026-01-20.csv
 *    -> Set rejection reason to "Fraud Interview"
 *
 * 2) /var/www/Report-Generation/ManualMultireject/cati_rejection_processing_2026-01-02T23-32-48.csv
 *    -> Set rejection reason to "NWR in Q5, Q6 & Q8"
 *
 * IMPORTANT: Only updates rejection-reason fields, does NOT touch any other fields.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');

const FRAUD_CSV_PATH = '/var/www/opine/backend/reports/reject-fraud-interviews-report-2026-01-20.csv';
const NWR_CSV_PATH = '/var/www/Report-Generation/ManualMultireject/cati_rejection_processing_2026-01-02T23-32-48.csv';

function readLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim().length > 0);
}

async function applyUpdatesFromCsv() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000
  });
  console.log('✅ Connected to MongoDB\n');

  const summary = {
    fraud: { totalRows: 0, updated: 0, notFound: 0, skippedNonRejected: 0 },
    nwr: { totalRows: 0, updated: 0, notFound: 0, skippedNonRejected: 0 }
  };

  // 1) Fraud Interview fixes
  if (fs.existsSync(FRAUD_CSV_PATH)) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Updating Fraud Interview rejection reasons');
    console.log('═══════════════════════════════════════════════════════════\n');

    const lines = readLines(FRAUD_CSV_PATH);
    if (lines.length <= 1) {
      console.log('⚠️  Fraud CSV has no data rows, skipping.\n');
    } else {
      // Header: Response ID,Status,Previous Status,New Status,Rejection Reason,...
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        summary.fraud.totalRows++;

        // Response ID is the first column; safe to split by comma and take [0]
        const parts = line.split(',');
        const responseId = (parts[0] || '').replace(/"/g, '').trim();
        if (!responseId) continue;

        // Update only if status is Rejected
        const response = await SurveyResponse.findOne({ responseId }).select('_id status').lean();
        if (!response) {
          summary.fraud.notFound++;
          continue;
        }
        if (response.status !== 'Rejected') {
          summary.fraud.skippedNonRejected++;
          continue;
        }

        const update = {
          $set: {
            'verificationData.feedback': 'Fraud Interview',
            'metadata.rejectionReason': 'Fraud Interview',
            'metadata.manualRejectionReason': 'Fraud Interview'
          }
        };

        const result = await SurveyResponse.updateOne({ _id: response._id }, update);
        if (result.modifiedCount > 0) {
          summary.fraud.updated++;
        }
      }
    }
  } else {
    console.log(`⚠️  Fraud CSV not found at ${FRAUD_CSV_PATH}, skipping.\n`);
  }

  // 2) NWR in Q5, Q6 & Q8 fixes (CATI manual multi-reject)
  if (fs.existsSync(NWR_CSV_PATH)) {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Updating NWR in Q5, Q6 & Q8 rejection reasons (CATI manual multi-reject)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const lines = readLines(NWR_CSV_PATH);
    if (lines.length <= 1) {
      console.log('⚠️  NWR CSV has no data rows, skipping.\n');
    } else {
      // Header: Category,Response ID,Mongo ID,Previous Status,Reason/Note
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        summary.nwr.totalRows++;

        const parts = line.split(',');
        // parts[1] = Response ID
        const responseId = (parts[1] || '').replace(/"/g, '').trim();
        if (!responseId) continue;

        const response = await SurveyResponse.findOne({ responseId }).select('_id status').lean();
        if (!response) {
          summary.nwr.notFound++;
          continue;
        }
        if (response.status !== 'Rejected') {
          summary.nwr.skippedNonRejected++;
          continue;
        }

        const reasonText = 'NWR in Q5, Q6 & Q8';
        const update = {
          $set: {
            'verificationData.feedback': reasonText,
            'metadata.rejectionReason': reasonText,
            'metadata.manualRejectionReason': reasonText
          }
        };

        const result = await SurveyResponse.updateOne({ _id: response._id }, update);
        if (result.modifiedCount > 0) {
          summary.nwr.updated++;
        }
      }
    }
  } else {
    console.log(`⚠️  NWR CSV not found at ${NWR_CSV_PATH}, skipping.\n`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 Update Summary');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Fraud Interview CSV:');
  console.log(`   Rows processed:         ${summary.fraud.totalRows}`);
  console.log(`   Updated (Rejected):     ${summary.fraud.updated}`);
  console.log(`   Not found in DB:        ${summary.fraud.notFound}`);
  console.log(`   Skipped (non-Rejected): ${summary.fraud.skippedNonRejected}\n`);

  console.log('NWR CSV:');
  console.log(`   Rows processed:         ${summary.nwr.totalRows}`);
  console.log(`   Updated (Rejected):     ${summary.nwr.updated}`);
  console.log(`   Not found in DB:        ${summary.nwr.notFound}`);
  console.log(`   Skipped (non-Rejected): ${summary.nwr.skippedNonRejected}\n`);

  await mongoose.disconnect();
  console.log('✅ Done.');
}

applyUpdatesFromCsv().catch(async (err) => {
  console.error('❌ Error running fix script:', err);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});






