#!/usr/bin/env node

/**
 * Update Survey Response Statuses from Excel File (23rd Feb 2026)
 *
 * This script:
 * 1. Reads Response IDs and Status from Excel file (two sheets: CATI and CAPI)
 * 2. Checks current status in MongoDB for each Response ID
 * 3. If status matches Excel, leaves it untouched
 * 4. If status doesn't match, updates to match Excel (only status is changed)
 * 5. If changing to "Rejected", sets verificationData.feedback as "Manual Rejection on 24th feb"
 * 6. Does NOT change any other fields (reviewer, etc.) except status and feedback when rejected
 * 7. Creates a detailed report of all changes for rollback purposes
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const EXCEL_FILE_PATH = '/var/www/opine/backend/data/Vijay_Status change for CATI and CAPI_23rd Feb.xlsx';
const VALID_STATUSES = ['Pending_Approval', 'Approved', 'Rejected', 'completed', 'abandoned', 'Terminated'];
const REPORT_DIR = '/var/www/opine/backend/scripts/reports';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const REJECTION_FEEDBACK = 'Manual Rejection on 24th feb';

/**
 * Normalize status to match MongoDB values
 */
const normalizeStatus = (status) => {
  if (!status) return null;
  const normalized = String(status).trim();

  const statusMap = {
    'pending': 'Pending_Approval',
    'pending approval': 'Pending_Approval',
    'pending_approval': 'Pending_Approval',
    'approved': 'Approved',
    'rejected': 'Rejected',
    'complete': 'completed',
    'completed': 'completed',
    'abandon': 'abandoned',
    'abandoned': 'abandoned',
    'terminate': 'Terminated',
    'terminated': 'Terminated'
  };

  const lower = normalized.toLowerCase();
  return statusMap[lower] || normalized;
};

/**
 * Read Excel file and extract Response IDs with Status from both CATI and CAPI sheets
 */
const readExcelData = () => {
  try {
    console.log('📖 Reading Excel file...');
    console.log(`   File: ${EXCEL_FILE_PATH}\n`);

    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`Excel file not found: ${EXCEL_FILE_PATH}`);
    }

    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const responseMap = new Map(); // Map<responseId, {revisedStatus, sheetName}>

    const targetSheets = ['CATI', 'CAPI'];

    targetSheets.forEach((sheetName) => {
      if (!workbook.SheetNames.includes(sheetName)) {
        console.log(`⚠️  Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
        return;
      }

      console.log(`📋 Processing Sheet: ${sheetName}`);
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      console.log(`   Found ${data.length} rows`);

      let validRows = 0;
      let invalidRows = 0;

      data.forEach((row, rowIndex) => {
        const responseId = row['Response ID'] || row['responseId'] || row['ResponseID'] || row['response_id'];
        const revisedStatus = row['Revised Status'] || row['Revised status'] || row['Status'] || row['status'] || row['revisedStatus'] || row['revised_status'];

        if (!responseId || String(responseId).trim() === '') {
          invalidRows++;
          if (invalidRows <= 5) {
            console.log(`   ⚠️  Row ${rowIndex + 2}: Missing Response ID`);
          }
          return;
        }

        if (!revisedStatus || String(revisedStatus).trim() === '') {
          invalidRows++;
          if (invalidRows <= 5) {
            console.log(`   ⚠️  Row ${rowIndex + 2}: Missing Status`);
          }
          return;
        }

        const normalizedStatus = normalizeStatus(revisedStatus);
        if (!VALID_STATUSES.includes(normalizedStatus)) {
          invalidRows++;
          if (invalidRows <= 5) {
            console.log(`   ⚠️  Row ${rowIndex + 2}: Invalid status "${revisedStatus}" (normalized: "${normalizedStatus}")`);
          }
          return;
        }

        const trimmedId = String(responseId).trim();
        if (responseMap.has(trimmedId)) {
          const existing = responseMap.get(trimmedId);
          console.log(`   ⚠️  Duplicate Response ID "${trimmedId}" found in ${sheetName} (already in ${existing.sheetName})`);
        }

        responseMap.set(trimmedId, {
          revisedStatus: normalizedStatus,
          sheetName: sheetName
        });
        validRows++;
      });

      console.log(`   ✅ Valid rows: ${validRows}`);
      if (invalidRows > 0) {
        console.log(`   ⚠️  Invalid rows: ${invalidRows}`);
      }
      console.log('');
    });

    console.log(`📊 Total unique Response IDs: ${responseMap.size}\n`);
    return responseMap;
  } catch (error) {
    console.error('❌ Error reading Excel file:', error.message);
    throw error;
  }
};

/**
 * Main function
 */
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const responseMap = readExcelData();

    if (responseMap.size === 0) {
      console.log('⚠️  No valid Response IDs found in Excel file. Exiting.\n');
      await mongoose.disconnect();
      return;
    }

    const responseIds = Array.from(responseMap.keys());
    const totalToCheck = responseIds.length;

    console.log('🔍 Checking current statuses in MongoDB...\n');

    const batchSize = 1000;
    const responses = new Map();
    let processed = 0;

    for (let i = 0; i < responseIds.length; i += batchSize) {
      const batch = responseIds.slice(i, i + batchSize);

      const foundResponses = await SurveyResponse.find({
        responseId: { $in: batch }
      })
        .select('_id responseId status verificationData')
        .lean();

      foundResponses.forEach(r => {
        responses.set(r.responseId, {
          _id: r._id.toString(),
          responseId: r.responseId,
          currentStatus: r.status,
          verificationData: r.verificationData || {}
        });
      });

      processed += batch.length;
      if (processed % 5000 === 0 || processed === totalToCheck) {
        console.log(`   ✅ Checked ${processed}/${totalToCheck} Response IDs...`);
      }
    }

    console.log(`\n📊 Found ${responses.size} responses in database\n`);

    const toUpdate = [];
    const unchanged = [];
    const notFound = [];

    responseMap.forEach((data, responseId) => {
      const response = responses.get(responseId);

      if (!response) {
        notFound.push({
          responseId: responseId,
          revisedStatus: data.revisedStatus,
          sheetName: data.sheetName
        });
        return;
      }

      if (response.currentStatus === data.revisedStatus) {
        unchanged.push({
          responseId: responseId,
          _id: response._id,
          status: response.currentStatus,
          sheetName: data.sheetName
        });
        return;
      }

      toUpdate.push({
        responseId: responseId,
        _id: response._id,
        currentStatus: response.currentStatus,
        revisedStatus: data.revisedStatus,
        sheetName: data.sheetName,
        currentFeedback: response.verificationData?.feedback || ''
      });
    });

    console.log('='.repeat(70));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Response IDs in Excel: ${responseMap.size}`);
    console.log(`Found in Database: ${responses.size}`);
    console.log(`Not Found in Database: ${notFound.length}`);
    console.log(`Status Already Correct (unchanged): ${unchanged.length}`);
    console.log(`Status Needs Update: ${toUpdate.length}`);
    console.log('='.repeat(70));
    console.log('');

    if (toUpdate.length === 0) {
      console.log('✅ No status updates needed. All responses already have correct status.\n');
      await mongoose.disconnect();
      return;
    }

    const statusChanges = {};
    const rejectionsToUpdate = [];
    toUpdate.forEach(item => {
      const change = `${item.currentStatus} → ${item.revisedStatus}`;
      statusChanges[change] = (statusChanges[change] || 0) + 1;

      if (item.revisedStatus === 'Rejected') {
        rejectionsToUpdate.push(item);
      }
    });

    console.log('📋 Status Changes Required:');
    Object.entries(statusChanges).forEach(([change, count]) => {
      console.log(`   ${change}: ${count}`);
    });
    console.log(`\n📋 Responses changing to Rejected: ${rejectionsToUpdate.length}`);
    console.log(`   (Will set verificationData.feedback: "${REJECTION_FEEDBACK}")\n`);

    console.log('='.repeat(70));
    console.log('UPDATING RESPONSES');
    console.log('='.repeat(70));
    console.log(`Total to update: ${toUpdate.length}\n`);

    const updateTimestamp = new Date();
    const updatedData = [];
    const errors = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < toUpdate.length; i++) {
      const item = toUpdate[i];
      try {
        const updateFields = {
          status: item.revisedStatus,
          updatedAt: updateTimestamp
        };

        if (item.revisedStatus === 'Rejected') {
          updateFields['verificationData.feedback'] = REJECTION_FEEDBACK;
        }

        const result = await SurveyResponse.updateOne(
          { _id: new mongoose.Types.ObjectId(item._id) },
          { $set: updateFields }
        );

        if (result.modifiedCount === 1) {
          successCount++;
          updatedData.push({
            responseId: item.responseId,
            _id: item._id,
            previousStatus: item.currentStatus,
            newStatus: item.revisedStatus,
            sheetName: item.sheetName,
            previousFeedback: item.currentFeedback,
            newFeedback: item.revisedStatus === 'Rejected' ? REJECTION_FEEDBACK : item.currentFeedback,
            updatedAt: updateTimestamp.toISOString()
          });

          if ((i + 1) % 500 === 0) {
            console.log(`   ✅ Updated ${i + 1}/${toUpdate.length} responses...`);
          }
        } else {
          errorCount++;
          errors.push({
            responseId: item.responseId,
            _id: item._id,
            error: 'No document modified (may have been updated by another process)'
          });
        }
      } catch (error) {
        errorCount++;
        errors.push({
          responseId: item.responseId,
          _id: item._id,
          error: error.message
        });
        if (errorCount <= 10) {
          console.error(`   ❌ Error updating response ${item.responseId}:`, error.message);
        }
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log('UPDATE SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`⏭️  Unchanged (already correct): ${unchanged.length}`);
    console.log(`❓ Not found in database: ${notFound.length}`);
    console.log('='.repeat(70));
    console.log('');

    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    const reportPrefix = `status_update_23feb24_${TIMESTAMP}`;

    const jsonReport = {
      metadata: {
        timestamp: updateTimestamp.toISOString(),
        excelFile: EXCEL_FILE_PATH,
        totalInExcel: responseMap.size,
        foundInDatabase: responses.size,
        notFound: notFound.length,
        unchanged: unchanged.length,
        updated: successCount,
        errors: errorCount,
        rejectionFeedback: REJECTION_FEEDBACK
      },
      updated: updatedData,
      unchanged: unchanged,
      notFound: notFound,
      errors: errors,
      statusChanges: statusChanges
    };

    const jsonReportPath = path.join(REPORT_DIR, `${reportPrefix}.json`);
    fs.writeFileSync(jsonReportPath, JSON.stringify(jsonReport, null, 2));
    console.log(`📄 Detailed JSON report: ${jsonReportPath}`);

    if (updatedData.length > 0) {
      const csvRows = [
        ['Response ID', 'MongoDB _id', 'Previous Status', 'New Status', 'Sheet Name', 'Previous Feedback', 'New Feedback', 'Updated At'].join(',')
      ];

      updatedData.forEach(item => {
        csvRows.push([
          `"${(item.responseId || '').replace(/"/g, '""')}"`,
          `"${item._id}"`,
          `"${(item.previousStatus || '').replace(/"/g, '""')}"`,
          `"${(item.newStatus || '').replace(/"/g, '""')}"`,
          `"${(item.sheetName || '').replace(/"/g, '""')}"`,
          `"${(item.previousFeedback || '').replace(/"/g, '""')}"`,
          `"${(item.newFeedback || '').replace(/"/g, '""')}"`,
          `"${item.updatedAt}"`
        ].join(','));
      });

      const csvReportPath = path.join(REPORT_DIR, `${reportPrefix}_updated.csv`);
      fs.writeFileSync(csvReportPath, csvRows.join('\n'));
      console.log(`📄 CSV report (updated only): ${csvReportPath}`);
    }

    const rollbackScriptPath = path.join(REPORT_DIR, `${reportPrefix}_rollback.js`);
    const rollbackDataJson = JSON.stringify(updatedData.map(item => ({
      _id: item._id,
      responseId: item.responseId,
      previousStatus: item.previousStatus,
      newStatus: item.newStatus,
      previousFeedback: item.previousFeedback,
      newFeedback: item.newFeedback
    })), null, 2);

    const rollbackScript = `#!/usr/bin/env node

/**
 * Rollback Script for Response Status Updates (23rd Feb Excel - 24th Feb run)
 * Generated: ${updateTimestamp.toISOString()}
 *
 * This script reverts the status changes made by update_status_from_excel_23feb24.js
 * Run: cd /var/www/opine/backend && node scripts/reports/${path.basename(rollbackScriptPath)}
 */

const mongoose = require('mongoose');
const path = require('path');
const SurveyResponse = require('../../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const rollbackData = ${rollbackDataJson};

async function rollback() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\\n');

    console.log('🔄 Rolling back ' + rollbackData.length + ' response statuses...\\n');

    let successCount = 0;
    let errorCount = 0;

    for (const item of rollbackData) {
      try {
        const updateFields = {
          status: item.previousStatus,
          updatedAt: new Date()
        };

        if (item.newFeedback !== item.previousFeedback) {
          if (item.previousFeedback === '') {
            await SurveyResponse.updateOne(
              { _id: new mongoose.Types.ObjectId(item._id) },
              {
                $set: updateFields,
                $unset: { 'verificationData.feedback': '' }
              }
            );
          } else {
            updateFields['verificationData.feedback'] = item.previousFeedback;
            await SurveyResponse.updateOne(
              { _id: new mongoose.Types.ObjectId(item._id) },
              { $set: updateFields }
            );
          }
        } else {
          await SurveyResponse.updateOne(
            { _id: new mongoose.Types.ObjectId(item._id) },
            { $set: updateFields }
          );
        }

        successCount++;
      } catch (error) {
        errorCount++;
        console.error('❌ Error rolling back ' + item.responseId + ':', error.message);
      }
    }

    console.log('\\n' + '='.repeat(70));
    console.log('ROLLBACK SUMMARY');
    console.log('='.repeat(70));
    console.log('✅ Successfully rolled back: ' + successCount);
    console.log('❌ Errors: ' + errorCount);
    console.log('='.repeat(70));

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

rollback();
`;

    fs.writeFileSync(rollbackScriptPath, rollbackScript);
    fs.chmodSync(rollbackScriptPath, '755');
    console.log(`📄 Rollback script: ${rollbackScriptPath}`);

    console.log('\n✅ All reports generated successfully!\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();
