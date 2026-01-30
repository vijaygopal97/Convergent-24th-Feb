#!/usr/bin/env node
/**
 * Reject duplicate CAPI Pending_Approval responses (last 4 days).
 * Keeps the earliest response per phone as original; rejects the rest with:
 *   "Duplicate Phone Number - {Original Response ID}"
 *
 * Safe and efficient:
 * - Streams with cursor (lean) to avoid memory blowup.
 * - Looks back only 4 days and only Pending_Approval, CAPI.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const LOOKBACK_DAYS = 4;
const PHONE_QUESTION_TEXT = 'Would you like to share your mobile number with us? We assure you we shall keep it confidential and shall use only for quality control purposes.';

function extractPhone(responses) {
  if (!Array.isArray(responses)) return null;
  const resp = responses.find(r => {
    const q = r.questionText || r.question?.text || '';
    return q.includes('mobile number') ||
           q.includes('phone number') ||
           q.toLowerCase().includes('share your mobile') ||
           q === PHONE_QUESTION_TEXT;
  });
  if (!resp || resp.response == null) return null;
  let v = resp.response;
  if (Array.isArray(v)) v = v[0];
  else if (typeof v === 'object' && v !== null) v = v.phone || v.value || v.text || v;
  if (v === '' || v === '0' || v === 0) return null;
  if (typeof v === 'string') return v.replace(/[\s\-()]/g, '').trim();
  if (typeof v === 'number') return v.toString();
  return null;
}

async function main() {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  await mongoose.connect(process.env.MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 5000 });
  console.log(`🔎 Scanning Pending_Approval CAPI responses since ${since.toISOString()}`);

  const cursor = SurveyResponse.find({
    interviewMode: 'capi',
    status: 'Pending_Approval',
    createdAt: { $gte: since }
  }).select('responseId responses createdAt').lean().cursor();

  const byPhone = new Map();
  let scanned = 0;
  for await (const doc of cursor) {
    scanned++;
    const phone = extractPhone(doc.responses);
    if (!phone) continue;
    const key = phone.toLowerCase();
    if (!byPhone.has(key)) byPhone.set(key, []);
    byPhone.get(key).push({ responseId: doc.responseId, createdAt: doc.createdAt });
  }

  const dupGroups = Array.from(byPhone.entries()).filter(([, arr]) => arr.length >= 2);
  console.log(`✅ Scanned: ${scanned}, phone groups: ${byPhone.size}, duplicates: ${dupGroups.length}`);

  if (!dupGroups.length) {
    await mongoose.disconnect();
    console.log('✅ No duplicates to reject.');
    return;
  }

  const ops = [];
  dupGroups.forEach(([, arr]) => {
    arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const original = arr[0];
    const duplicates = arr.slice(1);
    duplicates.forEach(dup => {
      ops.push({
        updateOne: {
          filter: { responseId: dup.responseId, status: 'Pending_Approval' },
          update: {
            $set: {
              status: 'Rejected',
              'verificationData.feedback': `Duplicate Phone Number - ${original.responseId}`,
              updatedAt: new Date()
            }
          }
        }
      });
    });
  });

  if (ops.length === 0) {
    await mongoose.disconnect();
    console.log('✅ No Pending_Approval duplicates to reject.');
    return;
  }

  const res = await SurveyResponse.bulkWrite(ops, { ordered: false });
  console.log('✅ Bulk reject complete:', res.result || res);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error rejecting duplicate phones:', err);
    mongoose.disconnect();
    process.exit(1);
  });
}

module.exports = { main };





