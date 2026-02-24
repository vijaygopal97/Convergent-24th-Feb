/**
 * Analyze manual rejections from Excel files and CSV reports
 * Find which rejection reasons can be recovered
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Rejection reason code mapping
const REJECTION_REASON_MAP = {
  '1': 'Short Duration',
  '2': 'GPS Distance Too Far',
  '3': 'Duplicate Phone Number',
  '4': 'Audio Quality Doesn\'t Meet the Standard',
  '5': 'Gender Mismatch',
  '6': '2021 Assembly Elections Mismatch',
  '7': '2024 Lok Sabha Elections Mismatch',
  '8': 'Upcoming Elections Mismatch',
  '9': 'Interviewer Performance/Quality Issues'
};

async function analyzeManualRejections() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔍 Analyzing Manual Rejections from Files');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Read manual rejection files
    const manualRejections = {
      fromCSV: [],
      fromExcel: []
    };

    // Read CSV files
    const csvFiles = [
      '/var/www/opine/backend/reports/reject-fraud-interviews-report-2026-01-20.csv',
      '/var/www/Report-Generation/ManualMultireject/cati_rejection_processing_2026-01-02T23-32-48.csv'
    ];

    for (const csvFile of csvFiles) {
      if (fs.existsSync(csvFile)) {
        console.log(`📄 Reading CSV: ${csvFile}`);
        const content = fs.readFileSync(csvFile, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',');
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',');
          if (values.length > 0) {
            const responseId = values[0]?.replace(/"/g, '').trim();
            if (responseId && responseId !== 'Response ID') {
              manualRejections.fromCSV.push({
                responseId: responseId,
                source: path.basename(csvFile),
                rejectionReason: values[4] || values[headers.indexOf('Rejection Reason')] || 'Unknown'
              });
            }
          }
        }
        console.log(`   Found ${lines.length - 1} entries\n`);
      }
    }

    // Read Excel files (if XLSX is available)
    const excelFiles = [
      '/var/www/reports/Vijay_CAPI & CATI_Server IDs for valid and Reject_5th Feb (1).xlsx',
      '/var/www/Report-Generation/Server IDs_ To Accept and Reject_Till 17th Jan.xlsx',
      '/var/www/Report-Generation/Vijay to Reject cases_Fraud Interviews_20th Ints.xlsx'
    ];

    for (const excelFile of excelFiles) {
      if (fs.existsSync(excelFile)) {
        try {
          console.log(`📊 Reading Excel: ${excelFile}`);
          const workbook = XLSX.readFile(excelFile);
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(worksheet);
          
          let count = 0;
          for (const row of data) {
            // Try to find response ID in various column names
            const responseId = row['Response ID'] || row['responseId'] || row['ResponseID'] || 
                              row['Server ID'] || row['serverId'] || row['ServerID'] ||
                              row['ID'] || row['id'] || Object.values(row)[0];
            
            if (responseId) {
              const status = row['Status'] || row['status'] || row['Action'] || row['action'];
              if (status && String(status).toLowerCase().includes('reject')) {
                manualRejections.fromExcel.push({
                  responseId: String(responseId),
                  source: path.basename(excelFile),
                  rejectionReason: row['Rejection Reason'] || row['Reason'] || 'Manual Rejection'
                });
                count++;
              }
            }
          }
          console.log(`   Found ${count} rejection entries\n`);
        } catch (error) {
          console.log(`   Error reading Excel: ${error.message}\n`);
        }
      }
    }

    console.log(`📊 Total Manual Rejections Found: ${manualRejections.fromCSV.length + manualRejections.fromExcel.length}\n`);

    // Get unique response IDs
    const allManualRejectionIds = [
      ...new Set([
        ...manualRejections.fromCSV.map(r => r.responseId),
        ...manualRejections.fromExcel.map(r => r.responseId)
      ])
    ];

    console.log(`📊 Unique Response IDs: ${allManualRejectionIds.length}\n`);

    // Fetch these responses from database
    console.log('🔍 Fetching responses from database...\n');
    const responses = await SurveyResponse.find({
      $or: [
        { responseId: { $in: allManualRejectionIds } },
        { _id: { $in: allManualRejectionIds.filter(id => id.length === 24) } }
      ],
      status: 'Rejected'
    })
      .select('_id responseId status verificationData interviewMode audioRecording createdAt')
      .read('secondaryPreferred')
      .maxTimeMS(300000)
      .limit(10000)
      .lean();

    console.log(`📊 Found ${responses.length} rejected responses in database\n`);

    // Analyze rejection reasons
    const rejectionAnalysis = {
      byReason: {},
      recoverable: {
        audioQuality: [],
        genderMismatch: [],
        electionsMismatch: [],
        interviewerPerformance: [],
        fraudInterview: []
      },
      unrecoverable: {
        shortDuration: [],
        gpsDistance: [],
        duplicatePhone: []
      }
    };

    for (const response of responses) {
      const verificationData = response.verificationData || {};
      const criteria = verificationData.criteria || verificationData.verificationCriteria || {};
      const feedback = verificationData.feedback || '';
      const feedbackLower = feedback.toLowerCase();

      // Determine rejection reason
      let reasonCode = '';
      let reasonText = '';

      // Check feedback for "Fraud Interview"
      if (feedbackLower.includes('fraud') || feedbackLower.includes('fraudulent')) {
        reasonText = 'Fraud Interview';
        reasonCode = 'fraud';
      } else if (criteria.audioStatus && !['1', '4', '7'].includes(String(criteria.audioStatus))) {
        reasonCode = '4';
        reasonText = REJECTION_REASON_MAP['4'];
      } else if (criteria.genderMatching && criteria.genderMatching !== '1') {
        reasonCode = '5';
        reasonText = REJECTION_REASON_MAP['5'];
      } else if (criteria.previousElectionsMatching && !['1', '3'].includes(String(criteria.previousElectionsMatching))) {
        reasonCode = '6';
        reasonText = REJECTION_REASON_MAP['6'];
      } else if (criteria.previousLoksabhaElectionsMatching && !['1', '3'].includes(String(criteria.previousLoksabhaElectionsMatching))) {
        reasonCode = '7';
        reasonText = REJECTION_REASON_MAP['7'];
      } else if (criteria.upcomingElectionsMatching && !['1', '3'].includes(String(criteria.upcomingElectionsMatching))) {
        reasonCode = '8';
        reasonText = REJECTION_REASON_MAP['8'];
      }

      if (!reasonCode && !reasonText) {
        reasonText = 'Unknown/Other';
      }

      const reasonKey = reasonCode || reasonText;
      if (!rejectionAnalysis.byReason[reasonKey]) {
        rejectionAnalysis.byReason[reasonKey] = {
          count: 0,
          samples: []
        };
      }
      rejectionAnalysis.byReason[reasonKey].count++;
      
      if (rejectionAnalysis.byReason[reasonKey].samples.length < 5) {
        rejectionAnalysis.byReason[reasonKey].samples.push({
          responseId: response.responseId || response._id.toString(),
          interviewMode: response.interviewMode || 'unknown',
          audioStatus: criteria.audioStatus,
          feedback: feedback.substring(0, 100)
        });
      }

      // Categorize recoverability
      if (reasonCode === '4') {
        const audioRec = response.audioRecording || {};
        if (audioRec.hasAudio && audioRec.fileSize > 0) {
          rejectionAnalysis.recoverable.audioQuality.push({
            responseId: response.responseId || response._id.toString(),
            audioStatus: criteria.audioStatus
          });
        }
      } else if (reasonCode === '5') {
        rejectionAnalysis.recoverable.genderMismatch.push({
          responseId: response.responseId || response._id.toString()
        });
      } else if (['6', '7', '8'].includes(reasonCode)) {
        rejectionAnalysis.recoverable.electionsMismatch.push({
          responseId: response.responseId || response._id.toString(),
          reasonCode: reasonCode
        });
      } else if (reasonText === 'Fraud Interview') {
        rejectionAnalysis.recoverable.fraudInterview.push({
          responseId: response.responseId || response._id.toString()
        });
      }
    }

    // Display results
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Manual Rejection Reasons Breakdown');
    console.log('═══════════════════════════════════════════════════════════\n');

    for (const [reason, data] of Object.entries(rejectionAnalysis.byReason)) {
      console.log(`${reason}: ${data.count}`);
      if (data.samples.length > 0) {
        console.log(`   Sample Response IDs:`);
        data.samples.forEach((s, idx) => {
          console.log(`      ${idx + 1}. ${s.responseId} (${s.interviewMode})`);
        });
      }
      console.log('');
    }

    // Recoverability summary
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔄 Recoverability Analysis for Manual Rejections');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('✅ Potentially Recoverable:');
    console.log(`   Audio Quality (Code 4): ${rejectionAnalysis.recoverable.audioQuality.length}`);
    console.log(`   Gender Mismatch (Code 5): ${rejectionAnalysis.recoverable.genderMismatch.length}`);
    console.log(`   Elections Mismatch (Codes 6,7,8): ${rejectionAnalysis.recoverable.electionsMismatch.length}`);
    console.log(`   Fraud Interview: ${rejectionAnalysis.recoverable.fraudInterview.length}`);
    const totalRecoverable = rejectionAnalysis.recoverable.audioQuality.length +
                             rejectionAnalysis.recoverable.genderMismatch.length +
                             rejectionAnalysis.recoverable.electionsMismatch.length +
                             rejectionAnalysis.recoverable.fraudInterview.length;
    console.log(`   Total Potentially Recoverable: ${totalRecoverable}\n`);

    await mongoose.disconnect();
    console.log('✅ Analysis complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

analyzeManualRejections();





