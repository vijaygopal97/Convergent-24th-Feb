const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    reportPath: null,
    dryRun: false,
    batchSize: 1000
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--report') out.reportPath = args[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--batch-size') out.batchSize = Number(args[++i]);
  }
  return out;
}

async function revertFromReport() {
  const { reportPath, dryRun, batchSize } = parseArgs();
  if (!reportPath) throw new Error('Missing --report /path/to/report.jsonl');
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);

  console.log('📄 Reverting using report:', reportPath);
  console.log('⚙️  Options:', { dryRun, batchSize });

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const rl = readline.createInterface({
    input: fs.createReadStream(reportPath),
    crlfDelay: Infinity
  });

  let buffer = [];
  let totalLines = 0;
  let totalOps = 0;
  let modified = 0;

  async function flush() {
    if (buffer.length === 0) return;

    const responseIds = buffer.map((x) => x.responseId);
    const docs = await SurveyResponse.find({ responseId: { $in: responseIds } })
      .select('_id responseId')
      .lean();
    const byResponseId = new Map(docs.map((d) => [d.responseId, d]));

    const ops = [];
    for (const entry of buffer) {
      const doc = byResponseId.get(entry.responseId);
      if (!doc) continue;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { 'verificationData.feedback': entry.oldFeedback } }
        }
      });
    }

    if (!dryRun && ops.length > 0) {
      const res = await SurveyResponse.bulkWrite(ops, { ordered: false });
      modified += (res.modifiedCount || 0);
    }

    totalOps += ops.length;
    buffer = [];
  }

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry.responseId) continue;
    buffer.push(entry);
    if (buffer.length >= batchSize) {
      await flush();
    }
  }

  await flush();
  await mongoose.disconnect();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 REVERT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Report lines read:', totalLines);
  console.log('Total update ops prepared:', totalOps);
  console.log('Modified (bulk modifiedCount):', modified);
  console.log('Dry run:', dryRun);
  console.log('═══════════════════════════════════════════════════════════\n');
}

revertFromReport().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});







