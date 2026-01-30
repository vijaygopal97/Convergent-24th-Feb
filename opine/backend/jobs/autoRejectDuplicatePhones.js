/**
 * Background job: auto-reject duplicate phone numbers in CAPI Pending_Approval.
 * Strategy: scan a recent window, keep earliest per phone, reject the rest.
 * Lightweight:
 *  - Uses cursor + lean
 *  - Limited lookback window
 *  - Redis lock to avoid concurrent runs
 */

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const redisOps = require('../utils/redisClient');

const LOOKBACK_MINUTES = 60; // window to scan
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

async function runAutoRejectDuplicatePhones() {
  const lockKey = 'job:autoRejectDuplicatePhones:lock';
  const lockVal = `${process.pid}-${Date.now()}`;
  // Acquire short lock to prevent concurrent runs (best-effort without NX)
  const existing = await redisOps.get(lockKey);
  if (existing) return;
  await redisOps.set(lockKey, lockVal, 60);

  try {
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
    const cursor = SurveyResponse.find({
      interviewMode: 'capi',
      status: 'Pending_Approval',
      createdAt: { $gte: since }
    }).select('responseId responses createdAt').lean().cursor();

    const byPhone = new Map();
    for await (const doc of cursor) {
      const phone = extractPhone(doc.responses);
      if (!phone) continue;
      const key = phone.toLowerCase();
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key).push({ responseId: doc.responseId, createdAt: doc.createdAt });
    }

    const dupGroups = Array.from(byPhone.entries()).filter(([, arr]) => arr.length >= 2);
    if (!dupGroups.length) return;

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

    if (ops.length) {
      await SurveyResponse.bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    console.error('autoRejectDuplicatePhones error:', err.message);
  } finally {
    try { await redisOps.del(lockKey); } catch (e) {}
  }
}

module.exports = runAutoRejectDuplicatePhones;

