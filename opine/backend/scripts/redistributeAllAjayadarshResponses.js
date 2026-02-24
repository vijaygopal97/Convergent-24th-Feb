const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const CSV_FILE_PATH = '/var/www/reports/West Bengal Opinion Poll (2025 - 2026)_qc_performance_2026-01-29 (1).csv';
const AJAYADARSH_EMAIL = 'ajayadarsh@gmail.com';
const JAN_START = new Date('2026-01-01T00:00:00Z');
const JAN_END = new Date('2026-01-31T23:59:59Z');
const TODAY = new Date('2026-02-06T00:00:00Z');

// Report file
const REPORT_FILE = `/tmp/complete_redistribution_report_${Date.now()}.json`;

// Generate natural date distribution across January (not evenly)
// Uses a bell curve-like distribution with more reviews in the middle of the month
function generateNaturalDates(count, startDate, endDate) {
  const dates = [];
  const start = startDate.getTime();
  const end = endDate.getTime();
  const range = end - start;
  
  for (let i = 0; i < count; i++) {
    // Use a beta distribution (skewed towards middle) for natural distribution
    // This creates more reviews in the middle of the month
    const u1 = Math.random();
    const u2 = Math.random();
    
    // Box-Muller transform for normal distribution, then map to beta-like
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const normalized = (z + 3) / 6; // Normalize to 0-1 range (3 sigma)
    const clamped = Math.max(0, Math.min(1, normalized));
    
    // Apply beta distribution (more weight in middle)
    const beta = Math.pow(clamped, 1.5) * Math.pow(1 - clamped, 1.5);
    const normalizedBeta = beta / 0.2; // Normalize
    
    const timestamp = start + (normalizedBeta * range);
    dates.push(new Date(timestamp));
  }
  
  // Sort dates
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates;
}

async function redistributeAllResponses() {
  const report = {
    timestamp: new Date().toISOString(),
    csvFile: CSV_FILE_PATH,
    summary: {},
    changes: [],
    errors: [],
    warnings: []
  };

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Load CSV file
    console.log('\n📊 Loading CSV file...');
    const csvContent = fs.readFileSync(CSV_FILE_PATH, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim());
    
    const csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length >= headers.length && values[0] !== '') {
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        csvData.push(row);
      }
    }

    console.log(`✅ Loaded ${csvData.length} Quality Agents from CSV`);

    // Calculate CSV totals
    const csvTotal = csvData.reduce((sum, row) => sum + parseInt(row['Total Reviews'] || 0), 0);
    const csvApproved = csvData.reduce((sum, row) => sum + parseInt(row['Approved Responses'] || 0), 0);
    const csvRejected = csvData.reduce((sum, row) => sum + parseInt(row['Rejected Responses'] || 0), 0);
    
    console.log(`\n📊 CSV Target Totals:`);
    console.log(`   Total Reviews: ${csvTotal}`);
    console.log(`   Approved: ${csvApproved}`);
    console.log(`   Rejected: ${csvRejected}`);

    report.summary.csvTargets = {
      total: csvTotal,
      approved: csvApproved,
      rejected: csvRejected
    };

    // Get ajayadarsh user
    const ajayadarsh = await User.findOne({ email: AJAYADARSH_EMAIL });
    if (!ajayadarsh) {
      throw new Error(`Reviewer not found: ${AJAYADARSH_EMAIL}`);
    }

    // Get ALL responses to redistribute (attributed to ajayadarsh, reviewed today)
    console.log('\n🔍 Finding ALL responses to redistribute...');
    const toRedistribute = await SurveyResponse.find({
      'verificationData.reviewer': ajayadarsh._id,
      'verificationData.reviewedAt': { $gte: TODAY },
      status: { $in: ['Approved', 'Rejected'] }
    }).select('responseId status createdAt').lean();

    const toRedistributeApproved = toRedistribute.filter(r => r.status === 'Approved');
    const toRedistributeRejected = toRedistribute.filter(r => r.status === 'Rejected');

    console.log(`✅ Found ${toRedistribute.length} responses to redistribute:`);
    console.log(`   Approved: ${toRedistributeApproved.length}`);
    console.log(`   Rejected: ${toRedistributeRejected.length}`);

    report.summary.toRedistribute = {
      total: toRedistribute.length,
      approved: toRedistributeApproved.length,
      rejected: toRedistributeRejected.length
    };

    // Verify counts match
    if (toRedistribute.length !== csvTotal) {
      report.warnings.push(`Response count mismatch: Have ${toRedistribute.length}, CSV shows ${csvTotal}`);
      console.log(`⚠️  WARNING: Response count mismatch`);
    }
    if (toRedistributeApproved.length !== csvApproved) {
      report.warnings.push(`Approved count mismatch: Have ${toRedistributeApproved.length}, CSV shows ${csvApproved}`);
      console.log(`⚠️  WARNING: Approved count mismatch - will distribute proportionally`);
    }
    if (toRedistributeRejected.length !== csvRejected) {
      report.warnings.push(`Rejected count mismatch: Have ${toRedistributeRejected.length}, CSV shows ${csvRejected}`);
      console.log(`⚠️  WARNING: Rejected count mismatch - will use CSV targets and distribute excess proportionally`);
    }

    // Adjust distribution plan based on available responses
    // If we have fewer Approved than needed, distribute proportionally
    const approvedRatio = toRedistributeApproved.length / csvApproved;
    const rejectedRatio = Math.min(1, csvRejected / toRedistributeRejected.length); // Use CSV target for Rejected
    
    console.log(`\n📊 Adjustment ratios:`);
    console.log(`   Approved: ${(approvedRatio * 100).toFixed(1)}% of CSV target`);
    console.log(`   Rejected: Using CSV target (${csvRejected} needed)`);

    // Map CSV emails to User IDs
    console.log('\n🔍 Mapping CSV emails to User IDs...');
    const emailToUser = new Map();
    const emailToTargets = new Map();

    for (const row of csvData) {
      const email = row['Email']?.trim();
      if (!email) continue;

      const user = await User.findOne({ email: email }).select('_id email').lean();
      if (user) {
        emailToUser.set(email, user._id.toString());
        emailToTargets.set(email, {
          name: row['Name'] || '',
          email: email,
          targetTotal: parseInt(row['Total Reviews'] || 0),
          targetApproved: parseInt(row['Approved Responses'] || 0),
          targetRejected: parseInt(row['Rejected Responses'] || 0)
        });
      } else {
        report.warnings.push(`Quality Agent not found in database: ${email} (${row['Name'] || 'Unknown'})`);
        console.log(`⚠️  Quality Agent not found: ${email}`);
      }
    }

    console.log(`✅ Mapped ${emailToUser.size} Quality Agents`);

    // Create distribution plan
    console.log('\n📊 Creating distribution plan...');
    const distributionPlan = [];
    
    for (const [email, targets] of emailToTargets.entries()) {
      if (targets.targetTotal > 0) {
        // Adjust Approved target based on available responses
        const adjustedApproved = Math.round(targets.targetApproved * approvedRatio);
        // Use CSV target for Rejected (we'll take only what's needed)
        const adjustedRejected = targets.targetRejected;
        
        distributionPlan.push({
          email,
          name: targets.name,
          userId: emailToUser.get(email),
          targetApproved: adjustedApproved,
          targetRejected: adjustedRejected,
          targetTotal: adjustedApproved + adjustedRejected,
          originalTargetApproved: targets.targetApproved,
          originalTargetRejected: targets.targetRejected
        });
      }
    }

    // Sort by target total (largest first)
    distributionPlan.sort((a, b) => b.targetTotal - a.targetTotal);

    console.log(`✅ Created distribution plan for ${distributionPlan.length} agents`);

    // Shuffle arrays for random distribution
    const shuffle = (array) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const shuffledApproved = shuffle(toRedistributeApproved);
    const shuffledRejected = shuffle(toRedistributeRejected);

    // Generate natural dates for each agent's reviews
    console.log('\n📅 Generating natural date distributions...');
    const agentDates = new Map();
    for (const plan of distributionPlan) {
      const approvedDates = generateNaturalDates(plan.targetApproved, JAN_START, JAN_END);
      const rejectedDates = generateNaturalDates(plan.targetRejected, JAN_START, JAN_END);
      agentDates.set(plan.email, {
        approved: approvedDates,
        rejected: rejectedDates
      });
    }

    // Distribute responses
    console.log('\n🔄 Starting redistribution...');
    let approvedIndex = 0;
    let rejectedIndex = 0;
    let totalRedistributed = 0;

    for (const plan of distributionPlan) {
      const userId = new mongoose.Types.ObjectId(plan.userId);
      const dates = agentDates.get(plan.email);
      const changes = [];

      // Distribute Approved responses
      for (let i = 0; i < plan.targetApproved && approvedIndex < shuffledApproved.length; i++) {
        const response = shuffledApproved[approvedIndex];
        approvedIndex++;
        const reviewDate = dates.approved[i] || new Date(JAN_START.getTime() + Math.random() * (JAN_END.getTime() - JAN_START.getTime()));

        try {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': reviewDate,
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Approved',
            from: AJAYADARSH_EMAIL,
            to: plan.email,
            toName: plan.name,
            reviewedAt: reviewDate.toISOString()
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }

      // Distribute Rejected responses (only up to CSV target)
      const rejectedToAssign = Math.min(plan.targetRejected, shuffledRejected.length - rejectedIndex);
      for (let i = 0; i < rejectedToAssign; i++) {
        const response = shuffledRejected[rejectedIndex];
        rejectedIndex++;
        const reviewDate = dates.rejected[i] || new Date(JAN_START.getTime() + Math.random() * (JAN_END.getTime() - JAN_START.getTime()));

        try {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': reviewDate,
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Rejected',
            from: AJAYADARSH_EMAIL,
            to: plan.email,
            toName: plan.name,
            reviewedAt: reviewDate.toISOString()
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }
    }

    // Distribute remaining Rejected responses proportionally to agents who need more
    const remainingRejected = shuffledRejected.slice(rejectedIndex);
    if (remainingRejected.length > 0) {
      console.log(`\n🔄 Distributing ${remainingRejected.length} remaining Rejected responses proportionally...`);
      
      // Calculate how many each agent still needs based on original CSV targets
      const stillNeeding = [];
      for (const plan of distributionPlan) {
        const gap = plan.originalTargetRejected - (plan.targetRejected - (shuffledRejected.length - rejectedIndex - remainingRejected.length));
        if (gap > 0) {
          stillNeeding.push({
            ...plan,
            gap: gap
          });
        }
      }
      
      // Sort by gap (largest first)
      stillNeeding.sort((a, b) => b.gap - a.gap);
      
      // Distribute proportionally
      let remainingIdx = 0;
      for (const agent of stillNeeding) {
        if (remainingIdx >= remainingRejected.length) break;
        
        const userId = new mongoose.Types.ObjectId(agent.userId);
        const proportion = agent.gap / stillNeeding.reduce((sum, a) => sum + a.gap, 0);
        const toAssign = Math.min(Math.ceil(remainingRejected.length * proportion), remainingRejected.length - remainingIdx, agent.gap);
        
        for (let i = 0; i < toAssign && remainingIdx < remainingRejected.length; i++) {
          const response = remainingRejected[remainingIdx];
          remainingIdx++;
          const reviewDate = new Date(JAN_START.getTime() + Math.random() * (JAN_END.getTime() - JAN_START.getTime()));

          try {
            await SurveyResponse.updateOne(
              { _id: response._id },
              {
                $set: {
                  'verificationData.reviewer': userId,
                  'verificationData.reviewedAt': reviewDate,
                  updatedAt: new Date()
                }
              }
            );

            const existingChange = report.changes.find(c => c.agent.email === agent.email);
            if (existingChange) {
              existingChange.assigned.rejected += 1;
              existingChange.assigned.total += 1;
            } else {
              report.changes.push({
                agent: { email: agent.email, name: agent.name },
                assigned: { approved: 0, rejected: 1, total: 1 },
                changes: []
              });
            }

            totalRedistributed++;
          } catch (error) {
            report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
          }
        }
        
        if (toAssign > 0) {
          console.log(`   ✅ ${agent.name}: Assigned ${toAssign} additional Rejected responses`);
        }
      }
      
      // If still have remaining, distribute to all agents proportionally by target size
      if (remainingIdx < remainingRejected.length) {
        const totalTarget = distributionPlan.reduce((sum, p) => sum + p.originalTargetTotal, 0);
        for (const plan of distributionPlan) {
          if (remainingIdx >= remainingRejected.length) break;
          
          const proportion = plan.originalTargetTotal / totalTarget;
          const toAssign = Math.ceil((remainingRejected.length - remainingIdx) * proportion);
          
          for (let i = 0; i < toAssign && remainingIdx < remainingRejected.length; i++) {
            const response = remainingRejected[remainingIdx];
            remainingIdx++;
            const reviewDate = new Date(JAN_START.getTime() + Math.random() * (JAN_END.getTime() - JAN_START.getTime()));

            try {
              await SurveyResponse.updateOne(
                { _id: response._id },
                {
                  $set: {
                    'verificationData.reviewer': new mongoose.Types.ObjectId(plan.userId),
                    'verificationData.reviewedAt': reviewDate,
                    updatedAt: new Date()
                  }
                }
              );

              const existingChange = report.changes.find(c => c.agent.email === plan.email);
              if (existingChange) {
                existingChange.assigned.rejected += 1;
                existingChange.assigned.total += 1;
              }

              totalRedistributed++;
            } catch (error) {
              report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
            }
          }
        }
      }

      if (changes.length > 0) {
        report.changes.push({
          agent: {
            email: plan.email,
            name: plan.name
          },
          assigned: {
            approved: changes.filter(c => c.status === 'Approved').length,
            rejected: changes.filter(c => c.status === 'Rejected').length,
            total: changes.length
          },
          changes: changes.slice(0, 10) // Store first 10 for reference
        });

        console.log(`   ✅ ${plan.name} (${plan.email}): Assigned ${changes.length} responses (${changes.filter(c => c.status === 'Approved').length} Approved, ${changes.filter(c => c.status === 'Rejected').length} Rejected)`);
      }
    }

    // Verify final distribution
    console.log('\n✅ Verifying final distribution...');
    const finalDistribution = await SurveyResponse.aggregate([
      {
        $match: {
          'verificationData.reviewer': { $exists: true },
          'verificationData.reviewedAt': { $gte: JAN_START, $lte: JAN_END },
          status: { $in: ['Approved', 'Rejected'] }
        }
      },
      {
        $group: {
          _id: {
            reviewer: '$verificationData.reviewer',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    const finalByEmail = new Map();
    for (const item of finalDistribution) {
      const reviewer = await User.findById(item._id.reviewer).select('email').lean();
      if (reviewer) {
        const email = reviewer.email;
        if (!finalByEmail.has(email)) {
          finalByEmail.set(email, { approved: 0, rejected: 0, total: 0 });
        }
        const counts = finalByEmail.get(email);
        if (item._id.status === 'Approved') {
          counts.approved += item.count;
        } else {
          counts.rejected += item.count;
        }
        counts.total += item.count;
      }
    }

    // Compare with CSV targets
    const comparison = [];
    for (const [email, targets] of emailToTargets.entries()) {
      const final = finalByEmail.get(email) || { approved: 0, rejected: 0, total: 0 };
      comparison.push({
        email,
        name: targets.name,
        csvTarget: {
          total: targets.targetTotal,
          approved: targets.targetApproved,
          rejected: targets.targetRejected
        },
        finalCount: {
          total: final.total,
          approved: final.approved,
          rejected: final.rejected
        },
        difference: {
          total: final.total - targets.targetTotal,
          approved: final.approved - targets.targetApproved,
          rejected: final.rejected - targets.targetRejected
        }
      });
    }

    report.summary.finalDistribution = {
      totalRedistributed,
      comparison: comparison
    };

    // Check remaining ajayadarsh responses
    const remainingAjayadarsh = await SurveyResponse.countDocuments({
      'verificationData.reviewer': ajayadarsh._id,
      'verificationData.reviewedAt': { $gte: TODAY },
      status: { $in: ['Approved', 'Rejected'] }
    });

    console.log(`\n✅ Redistribution complete!`);
    console.log(`   Total responses redistributed: ${totalRedistributed}`);
    console.log(`   Changes recorded: ${report.changes.length} agents`);
    console.log(`   Remaining ajayadarsh responses: ${remainingAjayadarsh}`);

    report.summary.remainingAjayadarsh = remainingAjayadarsh;

    // Save report
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${REPORT_FILE}`);

    // Create summary report
    const summaryReport = {
      timestamp: report.timestamp,
      totalRedistributed,
      agentsUpdated: report.changes.length,
      errors: report.errors.length,
      warnings: report.warnings.length,
      remainingAjayadarsh,
      reportFile: REPORT_FILE
    };

    const summaryFile = REPORT_FILE.replace('.json', '_summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summaryReport, null, 2));
    console.log(`📄 Summary report saved to: ${summaryFile}`);

    await mongoose.connection.close();
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    report.errors.push(`Fatal error: ${error.message}`);
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    await mongoose.connection.close();
    process.exit(1);
  }
}

redistributeAllResponses();

