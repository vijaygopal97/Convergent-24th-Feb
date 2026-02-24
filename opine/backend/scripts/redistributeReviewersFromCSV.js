const mongoose = require('mongoose');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const CSV_FILE_PATH = '/var/www/reports/West Bengal Opinion Poll (2025 - 2026)_qc_performance_2026-02-06 (1) (1).csv';
const AJAYADARSH_EMAIL = 'ajayadarsh@gmail.com';
const JAN_START = new Date('2026-01-01T00:00:00Z');
const JAN_END = new Date('2026-01-31T23:59:59Z');
const TODAY = new Date('2026-02-06T00:00:00Z');

// Report file
const REPORT_FILE = `/tmp/reviewer_redistribution_report_${Date.now()}.json`;

async function redistributeReviewers() {
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
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    
    const csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
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

    // Get responses to redistribute (reviewed in January, now attributed to ajayadarsh)
    console.log('\n🔍 Finding responses to redistribute...');
    const toRedistribute = await SurveyResponse.find({
      'verificationData.reviewer': ajayadarsh._id,
      'verificationData.reviewedAt': { $gte: TODAY },
      createdAt: { $gte: JAN_START, $lte: JAN_END },
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

    // Get current distribution (responses with other reviewers in January)
    console.log('\n📊 Getting current distribution...');
    const currentDistribution = await SurveyResponse.aggregate([
      {
        $match: {
          'verificationData.reviewer': { $exists: true, $ne: ajayadarsh._id },
          createdAt: { $gte: JAN_START, $lte: JAN_END },
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

    // Map current distribution by reviewer email
    const currentByEmail = new Map();
    for (const item of currentDistribution) {
      const reviewer = await User.findById(item._id.reviewer).select('email').lean();
      if (reviewer) {
        const email = reviewer.email;
        if (!currentByEmail.has(email)) {
          currentByEmail.set(email, { approved: 0, rejected: 0, total: 0 });
        }
        const counts = currentByEmail.get(email);
        if (item._id.status === 'Approved') {
          counts.approved += item.count;
        } else {
          counts.rejected += item.count;
        }
        counts.total += item.count;
      }
    }

    console.log(`✅ Found ${currentByEmail.size} Quality Agents with existing reviews`);

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

    // Calculate what each agent needs
    console.log('\n📊 Calculating distribution needs...');
    const distributionPlan = [];
    let totalNeededApproved = 0;
    let totalNeededRejected = 0;

    for (const [email, targets] of emailToTargets.entries()) {
      const current = currentByEmail.get(email) || { approved: 0, rejected: 0, total: 0 };
      const neededApproved = Math.max(0, targets.targetApproved - current.approved);
      const neededRejected = Math.max(0, targets.targetRejected - current.rejected);
      const neededTotal = neededApproved + neededRejected;

      if (neededTotal > 0) {
        distributionPlan.push({
          email,
          name: targets.name,
          userId: emailToUser.get(email),
          current: { ...current },
          target: {
            total: targets.targetTotal,
            approved: targets.targetApproved,
            rejected: targets.targetRejected
          },
          needed: {
            total: neededTotal,
            approved: neededApproved,
            rejected: neededRejected
          }
        });

        totalNeededApproved += neededApproved;
        totalNeededRejected += neededRejected;
      }
    }

    // Sort by priority (agents with highest needs first)
    distributionPlan.sort((a, b) => b.needed.total - a.needed.total);

    console.log(`\n📊 Distribution Plan:`);
    console.log(`   Agents needing reviews: ${distributionPlan.length}`);
    console.log(`   Total Approved needed: ${totalNeededApproved}`);
    console.log(`   Total Rejected needed: ${totalNeededRejected}`);
    console.log(`   Available Approved: ${toRedistributeApproved.length}`);
    console.log(`   Available Rejected: ${toRedistributeRejected.length}`);

    report.summary.distributionPlan = {
      agentsNeedingReviews: distributionPlan.length,
      totalNeededApproved,
      totalNeededRejected,
      availableApproved: toRedistributeApproved.length,
      availableRejected: toRedistributeRejected.length
    };

    // Check if we have enough responses
    if (totalNeededApproved > toRedistributeApproved.length) {
      report.warnings.push(`Not enough Approved responses: Need ${totalNeededApproved}, Have ${toRedistributeApproved.length}`);
      console.log(`⚠️  WARNING: Not enough Approved responses`);
    }
    if (totalNeededRejected > toRedistributeRejected.length) {
      report.warnings.push(`Not enough Rejected responses: Need ${totalNeededRejected}, Have ${toRedistributeRejected.length}`);
      console.log(`⚠️  WARNING: Not enough Rejected responses`);
    }

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

    // Distribute responses
    console.log('\n🔄 Starting redistribution...');
    let approvedIndex = 0;
    let rejectedIndex = 0;
    let totalRedistributed = 0;

    // First pass: Distribute to match exact needs
    for (const plan of distributionPlan) {
      const userId = new mongoose.Types.ObjectId(plan.userId);
      const changes = [];

      // Distribute Approved responses
      const approvedToAssign = Math.min(plan.needed.approved, shuffledApproved.length - approvedIndex);
      for (let i = 0; i < approvedToAssign; i++) {
        if (approvedIndex >= shuffledApproved.length) break;
        const response = shuffledApproved[approvedIndex];
        approvedIndex++;

        try {
          const originalResponse = await SurveyResponse.findById(response._id)
            .populate('verificationData.reviewer', 'email')
            .select('responseId status verificationData')
            .lean();

          const originalReviewer = originalResponse?.verificationData?.reviewer?.email || 'ajayadarsh@gmail.com';

          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Approved',
            from: originalReviewer,
            to: plan.email,
            toName: plan.name
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }

      // Distribute Rejected responses
      const rejectedToAssign = Math.min(plan.needed.rejected, shuffledRejected.length - rejectedIndex);
      for (let i = 0; i < rejectedToAssign; i++) {
        if (rejectedIndex >= shuffledRejected.length) break;
        const response = shuffledRejected[rejectedIndex];
        rejectedIndex++;

        try {
          const originalResponse = await SurveyResponse.findById(response._id)
            .populate('verificationData.reviewer', 'email')
            .select('responseId status verificationData')
            .lean();

          const originalReviewer = originalResponse?.verificationData?.reviewer?.email || 'ajayadarsh@gmail.com';

          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Rejected',
            from: originalReviewer,
            to: plan.email,
            toName: plan.name
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
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
          changes: changes
        });

        console.log(`   ✅ ${plan.name} (${plan.email}): Assigned ${changes.length} responses (${changes.filter(c => c.status === 'Approved').length} Approved, ${changes.filter(c => c.status === 'Rejected').length} Rejected)`);
      }
    }

    // Second pass: Distribute remaining responses to agents who are still below target
    console.log('\n🔄 Distributing remaining responses...');
    const remainingApproved = shuffledApproved.slice(approvedIndex);
    const remainingRejected = shuffledRejected.slice(rejectedIndex);
    
    console.log(`   Remaining Approved: ${remainingApproved.length}`);
    console.log(`   Remaining Rejected: ${remainingRejected.length}`);

    // Get updated current distribution
    const updatedDistribution = await SurveyResponse.aggregate([
      {
        $match: {
          'verificationData.reviewer': { $exists: true },
          createdAt: { $gte: JAN_START, $lte: JAN_END },
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

    const updatedByEmail = new Map();
    for (const item of updatedDistribution) {
      const reviewer = await User.findById(item._id.reviewer).select('email').lean();
      if (reviewer) {
        const email = reviewer.email;
        if (!updatedByEmail.has(email)) {
          updatedByEmail.set(email, { approved: 0, rejected: 0, total: 0 });
        }
        const counts = updatedByEmail.get(email);
        if (item._id.status === 'Approved') {
          counts.approved += item.count;
        } else {
          counts.rejected += item.count;
        }
        counts.total += item.count;
      }
    }

    // Find agents still below target (check both status-specific and total)
    const stillNeeding = [];
    for (const [email, targets] of emailToTargets.entries()) {
      const current = updatedByEmail.get(email) || { approved: 0, rejected: 0, total: 0 };
      const stillNeededApproved = Math.max(0, targets.targetApproved - current.approved);
      const stillNeededRejected = Math.max(0, targets.targetRejected - current.rejected);
      const stillNeededTotal = Math.max(0, targets.targetTotal - current.total);
      
      // Include if any gap exists (status-specific OR total)
      if (stillNeededApproved > 0 || stillNeededRejected > 0 || stillNeededTotal > 0) {
        stillNeeding.push({
          email,
          name: targets.name,
          userId: emailToUser.get(email),
          stillNeededApproved,
          stillNeededRejected,
          stillNeededTotal,
          priority: stillNeededApproved + stillNeededRejected + stillNeededTotal
        });
      }
    }

    stillNeeding.sort((a, b) => b.priority - a.priority);

    // Distribute remaining Approved
    let remainingApprovedIdx = 0;
    for (const agent of stillNeeding) {
      if (remainingApprovedIdx >= remainingApproved.length) break;
      const userId = new mongoose.Types.ObjectId(agent.userId);
      const changes = [];

      // Assign based on Approved gap, but also consider total gap
      const maxToAssign = Math.min(
        agent.stillNeededApproved > 0 ? agent.stillNeededApproved : agent.stillNeededTotal,
        remainingApproved.length - remainingApprovedIdx
      );
      const toAssign = maxToAssign;
      for (let i = 0; i < toAssign; i++) {
        const response = remainingApproved[remainingApprovedIdx];
        remainingApprovedIdx++;

        try {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Approved',
            from: 'ajayadarsh@gmail.com',
            to: agent.email,
            toName: agent.name
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }

      if (changes.length > 0) {
        const existingChange = report.changes.find(c => c.agent.email === agent.email);
        if (existingChange) {
          existingChange.assigned.approved += changes.length;
          existingChange.assigned.total += changes.length;
          existingChange.changes.push(...changes);
        } else {
          report.changes.push({
            agent: { email: agent.email, name: agent.name },
            assigned: { approved: changes.length, rejected: 0, total: changes.length },
            changes: changes
          });
        }
      }
    }

    // Distribute remaining Rejected
    let remainingRejectedIdx = 0;
    for (const agent of stillNeeding) {
      if (remainingRejectedIdx >= remainingRejected.length) break;
      const userId = new mongoose.Types.ObjectId(agent.userId);
      const changes = [];

      // Assign based on Rejected gap, but also consider total gap
      const maxToAssign = Math.min(
        agent.stillNeededRejected > 0 ? agent.stillNeededRejected : agent.stillNeededTotal,
        remainingRejected.length - remainingRejectedIdx
      );
      const toAssign = maxToAssign;
      for (let i = 0; i < toAssign; i++) {
        const response = remainingRejected[remainingRejectedIdx];
        remainingRejectedIdx++;

        try {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                updatedAt: new Date()
              }
            }
          );

          changes.push({
            responseId: response.responseId,
            status: 'Rejected',
            from: 'ajayadarsh@gmail.com',
            to: agent.email,
            toName: agent.name
          });

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }

      if (changes.length > 0) {
        const existingChange = report.changes.find(c => c.agent.email === agent.email);
        if (existingChange) {
          existingChange.assigned.rejected += changes.length;
          existingChange.assigned.total += changes.length;
          existingChange.changes.push(...changes);
        } else {
          report.changes.push({
            agent: { email: agent.email, name: agent.name },
            assigned: { approved: 0, rejected: changes.length, total: changes.length },
            changes: changes
          });
        }
      }
    }

    // Final pass: Distribute any remaining responses proportionally
    const finalRemainingApproved = remainingApproved.slice(remainingApprovedIdx);
    const finalRemainingRejected = remainingRejected.slice(remainingRejectedIdx);

    if (finalRemainingApproved.length > 0 || finalRemainingRejected.length > 0) {
      console.log(`\n⚠️  Still have ${finalRemainingApproved.length} Approved and ${finalRemainingRejected.length} Rejected responses remaining`);
      console.log('   Distributing proportionally to agents below target...');

      // Recalculate distribution after second pass
      const finalDistributionCheck = await SurveyResponse.aggregate([
        {
          $match: {
            'verificationData.reviewer': { $exists: true },
            createdAt: { $gte: JAN_START, $lte: JAN_END },
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

      const finalByEmailCheck = new Map();
      for (const item of finalDistributionCheck) {
        const reviewer = await User.findById(item._id.reviewer).select('email').lean();
        if (reviewer) {
          const email = reviewer.email;
          if (!finalByEmailCheck.has(email)) {
            finalByEmailCheck.set(email, { approved: 0, rejected: 0, total: 0 });
          }
          const counts = finalByEmailCheck.get(email);
          if (item._id.status === 'Approved') {
            counts.approved += item.count;
          } else {
            counts.rejected += item.count;
          }
          counts.total += item.count;
        }
      }

      // Get ALL agents and calculate gaps (for final distribution)
      const allAgents = [];
      for (const [email, targets] of emailToTargets.entries()) {
        const current = finalByEmailCheck.get(email) || { approved: 0, rejected: 0, total: 0 };
        const gapApproved = targets.targetApproved - current.approved;
        const gapRejected = targets.targetRejected - current.rejected;
        const gapTotal = targets.targetTotal - current.total;
        
        // Include ALL agents, even if they're at or above target (for overflow distribution)
        allAgents.push({
          email,
          name: targets.name,
          userId: emailToUser.get(email),
          gapApproved,
          gapRejected,
          gapTotal,
          currentTotal: current.total,
          targetTotal: targets.targetTotal,
          totalGap: gapTotal
        });
      }
      
      // Sort by gap (agents below target first, then by how much they're below)
      allAgents.sort((a, b) => {
        if (a.gapTotal > 0 && b.gapTotal <= 0) return -1;
        if (a.gapTotal <= 0 && b.gapTotal > 0) return 1;
        return b.gapTotal - a.gapTotal;
      });

      allAgents.sort((a, b) => b.totalGap - a.totalGap);

      // Distribute remaining Approved proportionally
      // Prioritize agents with Approved gap, then agents with total gap
      allAgents.sort((a, b) => {
        if (a.gapApproved > 0 && b.gapApproved <= 0) return -1;
        if (a.gapApproved <= 0 && b.gapApproved > 0) return 1;
        return b.totalGap - a.totalGap;
      });

      let finalApprovedIdx = 0;
      for (const agent of allAgents) {
        if (finalApprovedIdx >= finalRemainingApproved.length) break;
        // Distribute to agents below target (prioritize those with Approved gap)
        if (agent.gapTotal <= 0 && agent.gapApproved <= 0) continue;

        const userId = new mongoose.Types.ObjectId(agent.userId);
        const response = finalRemainingApproved[finalApprovedIdx];
        finalApprovedIdx++;

        try {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                'verificationData.reviewer': userId,
                'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                updatedAt: new Date()
              }
            }
          );

          const existingChange = report.changes.find(c => c.agent.email === agent.email);
          if (existingChange) {
            existingChange.assigned.approved += 1;
            existingChange.assigned.total += 1;
            existingChange.changes.push({
              responseId: response.responseId,
              status: 'Approved',
              from: 'ajayadarsh@gmail.com',
              to: agent.email,
              toName: agent.name
            });
          }

          totalRedistributed++;
        } catch (error) {
          report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
        }
      }

      // Distribute remaining Rejected proportionally
      // Prioritize agents with Rejected gap, then agents with total gap
      allAgents.sort((a, b) => {
        if (a.gapRejected > 0 && b.gapRejected <= 0) return -1;
        if (a.gapRejected <= 0 && b.gapRejected > 0) return 1;
        return b.totalGap - a.totalGap;
      });

      let finalRejectedIdx = 0;
      
      // Check if all agents are at/above target
      const allAtTarget = allAgents.every(a => a.gapTotal <= 0);
      
      if (allAtTarget) {
        // All agents are at/above target - distribute proportionally based on target size
        const totalTarget = allAgents.reduce((sum, a) => sum + a.targetTotal, 0);
        let distributed = 0;
        
        for (const agent of allAgents) {
          if (finalRejectedIdx >= finalRemainingRejected.length) break;
          
          const proportion = agent.targetTotal / totalTarget;
          const shouldAssign = Math.ceil(finalRemainingRejected.length * proportion) - distributed;
          const toAssign = Math.min(shouldAssign, finalRemainingRejected.length - finalRejectedIdx);
          
          for (let i = 0; i < toAssign && finalRejectedIdx < finalRemainingRejected.length; i++) {
            const response = finalRemainingRejected[finalRejectedIdx];
            finalRejectedIdx++;
            distributed++;
            
            const userId = new mongoose.Types.ObjectId(agent.userId);
            
            try {
              await SurveyResponse.updateOne(
                { _id: response._id },
                {
                  $set: {
                    'verificationData.reviewer': userId,
                    'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                    updatedAt: new Date()
                  }
                }
              );

              const existingChange = report.changes.find(c => c.agent.email === agent.email);
              if (existingChange) {
                existingChange.assigned.rejected += 1;
                existingChange.assigned.total += 1;
                existingChange.changes.push({
                  responseId: response.responseId,
                  status: 'Rejected',
                  from: 'ajayadarsh@gmail.com',
                  to: agent.email,
                  toName: agent.name
                });
              } else {
                report.changes.push({
                  agent: { email: agent.email, name: agent.name },
                  assigned: { approved: 0, rejected: 1, total: 1 },
                  changes: [{
                    responseId: response.responseId,
                    status: 'Rejected',
                    from: 'ajayadarsh@gmail.com',
                    to: agent.email,
                    toName: agent.name
                  }]
                });
              }

              totalRedistributed++;
            } catch (error) {
              report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
            }
          }
        }
      } else {
        // Some agents are below target - prioritize them
        for (const agent of allAgents) {
          if (finalRejectedIdx >= finalRemainingRejected.length) break;
          // Skip agents at/above target if we have agents below target
          if (agent.gapTotal <= 0) continue;

          const userId = new mongoose.Types.ObjectId(agent.userId);
          const response = finalRemainingRejected[finalRejectedIdx];
          finalRejectedIdx++;

          try {
            await SurveyResponse.updateOne(
              { _id: response._id },
              {
                $set: {
                  'verificationData.reviewer': userId,
                  'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                  updatedAt: new Date()
                }
              }
            );

            const existingChange = report.changes.find(c => c.agent.email === agent.email);
            if (existingChange) {
              existingChange.assigned.rejected += 1;
              existingChange.assigned.total += 1;
              existingChange.changes.push({
                responseId: response.responseId,
                status: 'Rejected',
                from: 'ajayadarsh@gmail.com',
                to: agent.email,
                toName: agent.name
              });
            } else {
              report.changes.push({
                agent: { email: agent.email, name: agent.name },
                assigned: { approved: 0, rejected: 1, total: 1 },
                changes: [{
                  responseId: response.responseId,
                  status: 'Rejected',
                  from: 'ajayadarsh@gmail.com',
                  to: agent.email,
                  toName: agent.name
                }]
              });
            }

            totalRedistributed++;
          } catch (error) {
            report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
          }
        }
        
        // If still have remaining, distribute to all agents proportionally
        if (finalRejectedIdx < finalRemainingRejected.length) {
          const totalTarget = allAgents.reduce((sum, a) => sum + a.targetTotal, 0);
          let distributed = 0;
          
          for (const agent of allAgents) {
            if (finalRejectedIdx >= finalRemainingRejected.length) break;
            
            const proportion = agent.targetTotal / totalTarget;
            const shouldAssign = Math.ceil((finalRemainingRejected.length - finalRejectedIdx) * proportion);
            const toAssign = Math.min(shouldAssign, finalRemainingRejected.length - finalRejectedIdx);
            
            for (let i = 0; i < toAssign && finalRejectedIdx < finalRemainingRejected.length; i++) {
              const response = finalRemainingRejected[finalRejectedIdx];
              finalRejectedIdx++;
              distributed++;
              
              const userId = new mongoose.Types.ObjectId(agent.userId);
              
              try {
                await SurveyResponse.updateOne(
                  { _id: response._id },
                  {
                    $set: {
                      'verificationData.reviewer': userId,
                      'verificationData.reviewedAt': new Date(response.createdAt || JAN_START),
                      updatedAt: new Date()
                    }
                  }
                );

                const existingChange = report.changes.find(c => c.agent.email === agent.email);
                if (existingChange) {
                  existingChange.assigned.rejected += 1;
                  existingChange.assigned.total += 1;
                  existingChange.changes.push({
                    responseId: response.responseId,
                    status: 'Rejected',
                    from: 'ajayadarsh@gmail.com',
                    to: agent.email,
                    toName: agent.name
                  });
                } else {
                  report.changes.push({
                    agent: { email: agent.email, name: agent.name },
                    assigned: { approved: 0, rejected: 1, total: 1 },
                    changes: [{
                      responseId: response.responseId,
                      status: 'Rejected',
                      from: 'ajayadarsh@gmail.com',
                      to: agent.email,
                      toName: agent.name
                    }]
                  });
                }

                totalRedistributed++;
              } catch (error) {
                report.errors.push(`Error updating response ${response.responseId}: ${error.message}`);
              }
            }
          }
        }
      }
    }

    // Verify final distribution
    console.log('\n✅ Verifying final distribution...');
    const finalDistribution = await SurveyResponse.aggregate([
      {
        $match: {
          'verificationData.reviewer': { $exists: true },
          createdAt: { $gte: JAN_START, $lte: JAN_END },
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

    console.log(`\n✅ Redistribution complete!`);
    console.log(`   Total responses redistributed: ${totalRedistributed}`);
    console.log(`   Changes recorded: ${report.changes.length} agents`);

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

redistributeReviewers();

