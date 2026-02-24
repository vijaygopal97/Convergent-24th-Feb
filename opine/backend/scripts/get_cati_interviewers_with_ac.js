#!/usr/bin/env node

/**
 * Get all CATI interviewers assigned to a survey who have AC assignments
 * 
 * Usage: node scripts/get_cati_interviewers_with_ac.js <surveyId>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const User = require('../models/User');

const SURVEY_ID = process.argv[2] || '68fd1915d41841da463f0d46';

async function getCatiInterviewersWithAC() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find survey
    const survey = await Survey.findById(SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }

    console.log(`📊 Survey: ${survey.surveyName || SURVEY_ID}`);
    console.log(`📋 Survey ID: ${SURVEY_ID}\n`);

    // Check if catiInterviewers exists
    if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
      console.log('⚠️  No CATI interviewers assigned to this survey');
      await mongoose.connection.close();
      return;
    }

    console.log(`📝 Total CATI interviewers assigned: ${survey.catiInterviewers.length}\n`);

    // Filter interviewers who have AC assignments
    const interviewersWithAC = survey.catiInterviewers.filter(
      assignment => assignment.assignedACs && 
                   Array.isArray(assignment.assignedACs) && 
                   assignment.assignedACs.length > 0
    );

    console.log(`✅ CATI interviewers with AC assignments: ${interviewersWithAC.length}\n`);

    if (interviewersWithAC.length === 0) {
      console.log('⚠️  No CATI interviewers have AC assignments');
      await mongoose.connection.close();
      return;
    }

    // Get interviewer details
    const interviewerIds = interviewersWithAC.map(a => a.interviewer);
    const interviewers = await User.find({ _id: { $in: interviewerIds } });

    // Create a map for quick lookup
    const interviewerMap = {};
    interviewers.forEach(interviewer => {
      interviewerMap[interviewer._id.toString()] = interviewer;
    });

    // Prepare results
    const results = interviewersWithAC.map(assignment => {
      const interviewer = interviewerMap[assignment.interviewer.toString()];
      return {
        memberId: interviewer ? interviewer.memberId : 'N/A',
        name: interviewer ? `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() : 'Unknown',
        phone: interviewer ? interviewer.phone : 'N/A',
        email: interviewer ? interviewer.email : 'N/A',
        assignedACs: assignment.assignedACs || [],
        status: assignment.status || 'N/A',
        assignedAt: assignment.assignedAt || 'N/A',
        interviewerId: assignment.interviewer.toString()
      };
    });

    // Sort by memberId
    results.sort((a, b) => {
      const aId = parseInt(a.memberId) || 0;
      const bId = parseInt(b.memberId) || 0;
      return aId - bId;
    });

    // Display results
    console.log('='.repeat(100));
    console.log('CATI INTERVIEWERS WITH AC ASSIGNMENTS');
    console.log('='.repeat(100));
    console.log();

    results.forEach((result, index) => {
      console.log(`${index + 1}. Member ID: ${result.memberId}`);
      console.log(`   Name: ${result.name}`);
      console.log(`   Phone: ${result.phone}`);
      console.log(`   Email: ${result.email}`);
      console.log(`   Assigned ACs: ${result.assignedACs.join(', ')}`);
      console.log(`   Status: ${result.status}`);
      if (result.assignedAt !== 'N/A') {
        console.log(`   Assigned At: ${new Date(result.assignedAt).toLocaleString()}`);
      }
      console.log();
    });

    console.log('='.repeat(100));
    console.log(`\n📊 Summary:`);
    console.log(`   Total CATI interviewers with AC assignments: ${results.length}`);
    console.log(`   Total ACs assigned: ${results.reduce((sum, r) => sum + r.assignedACs.length, 0)}`);
    console.log();

    // Save to JSON file
    const fs = require('fs');
    const outputDir = '/var/www/opine/backend/reports';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = `${outputDir}/cati_interviewers_with_ac_${Date.now()}.json`;
    fs.writeFileSync(outputPath, JSON.stringify({
      surveyId: SURVEY_ID,
      surveyName: survey.surveyName,
      generatedAt: new Date().toISOString(),
      totalInterviewersWithAC: results.length,
      interviewers: results
    }, null, 2));

    console.log(`💾 Results saved to: ${outputPath}`);

    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  getCatiInterviewersWithAC().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { getCatiInterviewersWithAC };

