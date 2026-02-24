#!/usr/bin/env node

/**
 * Update Survey Response Statuses from Excel File (Feb 19, 2026)
 * 
 * This script:
 * 1. Reads Response IDs and Revised Status from Excel file (two sheets: CATI and CAPI)
 * 2. Checks current status in MongoDB for each Response ID
 * 3. If status matches Excel, leaves it unchanged
 * 4. If status doesn't match, updates to match Excel
 * 5. If changing to "Rejected", sets verificationData.feedback as "Manual Rejection on 19th feb"
 * 6. Does NOT change reviewer information or any other fields except status and feedback
 * 7. Creates a detailed report of all changes for rollback purposes
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const EXCEL_FILE_PATH = '/var/www/MyLogos/KrishnaFiles/Vijay_Revised status for CAPI and CATI_1st Feb to 14th Feb.xlsx';
const VALID_STATUSES = ['Pending_Approval', 'Approved', 'Rejected', 'completed', 'abandoned', 'Terminated'];
const REPORT_DIR = '/var/www/opine/backend/scripts/reports';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const REJECTION_FEEDBACK = 'Manual Rejection on 19th feb';

/**
 * Normalize status to match MongoDB values
 */
const normalizeStatus = (status) => {
  if (!status) return null;
  const normalized = String(status).trim();
  
  // Map common variations
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
 * Read Excel file and extract Response IDs with Revised Status from both sheets
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
    
    // Process both CATI and CAPI sheets
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
        // Handle both "Revised Status" and "Revised status" column names
        const responseId = row['Response ID'] || row['responseId'] || row['ResponseID'] || row['response_id'];
        const revisedStatus = row['Revised Status'] || row['Revised status'] || row['revisedStatus'] || row['revised_status'];
        
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
            console.log(`   ⚠️  Row ${rowIndex + 2}: Missing Revised Status`);
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
        // Store in map (if duplicate, last one wins, but log it)
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
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Read Excel data
    const responseMap = readExcelData();
    
    if (responseMap.size === 0) {
      console.log('⚠️  No valid Response IDs found in Excel file. Exiting.\n');
      await mongoose.disconnect();
      return;
    }
    
    // Convert map to array for processing
    const responseIds = Array.from(responseMap.keys());
    const totalToCheck = responseIds.length;
    
    console.log('🔍 Checking current statuses in MongoDB...\n');
    
    // Fetch all responses in batches
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
    
    // Analyze what needs to be updated
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
      
      // Status needs to be updated
      toUpdate.push({
        responseId: responseId,
        _id: response._id,
        currentStatus: response.currentStatus,
        revisedStatus: data.revisedStatus,
        sheetName: data.sheetName,
        currentFeedback: response.verificationData?.feedback || ''
      });
    });
    
    // Print summary
    console.log('='.repeat(70));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Response IDs in Excel: ${responseMap.size}`);
    console.log(`Found in Database: ${responses.size}`);
    console.log(`Not Found in Database: ${notFound.length}`);
    console.log(`Status Already Correct: ${unchanged.length}`);
    console.log(`Status Needs Update: ${toUpdate.length}`);
    console.log('='.repeat(70));
    console.log('');
    
    if (toUpdate.length === 0) {
      console.log('✅ No status updates needed. All responses already have correct status.\n');
      await mongoose.disconnect();
      return;
    }
    
    // Show breakdown by status change
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
    
    // Perform updates
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
        // Prepare update object
        const updateFields = {
          status: item.revisedStatus,
          updatedAt: updateTimestamp
        };
        
        // If changing to Rejected, set feedback
        if (item.revisedStatus === 'Rejected') {
          // Use $set to update verificationData.feedback
          // If verificationData doesn't exist, create it
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
    
    // Create report directory
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    // Generate reports
    const reportPrefix = `status_update_feb19_${TIMESTAMP}`;
    
    // 1. JSON Report (detailed)
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
    
    // 2. CSV Report (updated responses only)
    if (updatedData.length > 0) {
      const csvRows = [
        ['Response ID', 'MongoDB _id', 'Previous Status', 'New Status', 'Sheet Name', 'Previous Feedback', 'New Feedback', 'Updated At'].join(',')
      ];
      
      updatedData.forEach(item => {
        csvRows.push([
          `"${item.responseId}"`,
          `"${item._id}"`,
          `"${item.previousStatus}"`,
          `"${item.newStatus}"`,
          `"${item.sheetName}"`,
          `"${item.previousFeedback}"`,
          `"${item.newFeedback}"`,
          `"${item.updatedAt}"`
        ].join(','));
      });
      
      const csvReportPath = path.join(REPORT_DIR, `${reportPrefix}_updated.csv`);
      fs.writeFileSync(csvReportPath, csvRows.join('\n'));
      console.log(`📄 CSV report (updated only): ${csvReportPath}`);
    }
    
    // 3. Rollback Script
    const rollbackScriptPath = path.join(REPORT_DIR, `${reportPrefix}_rollback.js`);
    const rollbackScript = `#!/usr/bin/env node

/**
 * Rollback Script for Response Status Updates (Feb 19, 2026)
 * Generated: ${updateTimestamp.toISOString()}
 * 
 * This script reverts the status changes made by update_status_from_excel_feb19.js
 * Run: cd /var/www/opine/backend && node scripts/reports/${path.basename(rollbackScriptPath)}
 */

const mongoose = require('mongoose');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const rollbackData = ${JSON.stringify(updatedData.map(item => ({
  _id: item._id,
  responseId: item.responseId,
  previousStatus: item.previousStatus,
  newStatus: item.newStatus,
  previousFeedback: item.previousFeedback,
  newFeedback: item.newFeedback
})), null, 2)};

async function rollback() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\\n');
    
    console.log(\`🔄 Rolling back \${rollbackData.length} response statuses...\\n\`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const item of rollbackData) {
      try {
        // Prepare rollback update
        const updateFields = {
          status: item.previousStatus,
          updatedAt: new Date()
        };
        
        // If feedback was changed, restore previous feedback
        if (item.newFeedback !== item.previousFeedback) {
          if (item.previousFeedback === '') {
            // Remove feedback if it was empty before
            await SurveyResponse.updateOne(
              { _id: new mongoose.Types.ObjectId(item._id) },
              { 
                $set: updateFields,
                $unset: { 'verificationData.feedback': '' }
              }
            );
          } else {
            // Restore previous feedback
            updateFields['verificationData.feedback'] = item.previousFeedback;
            await SurveyResponse.updateOne(
              { _id: new mongoose.Types.ObjectId(item._id) },
              { $set: updateFields }
            );
          }
        } else {
          // Just update status
          await SurveyResponse.updateOne(
            { _id: new mongoose.Types.ObjectId(item._id) },
            { $set: updateFields }
          );
        }
        
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(\`❌ Error rolling back \${item.responseId}:\`, error.message);
      }
    }
    
    console.log('\\n' + '='.repeat(70));
    console.log('ROLLBACK SUMMARY');
    console.log('='.repeat(70));
    console.log(\`✅ Successfully rolled back: \${successCount}\`);
    console.log(\`❌ Errors: \${errorCount}\`);
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












