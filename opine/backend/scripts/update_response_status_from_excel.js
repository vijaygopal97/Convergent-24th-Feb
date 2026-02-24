#!/usr/bin/env node

/**
 * Update Survey Response Statuses from Excel File
 * 
 * This script:
 * 1. Reads Response IDs and Revised Status from Excel file (two sheets: Vijay_CATI and Vijay_CAPI)
 * 2. Checks current status in MongoDB for each Response ID
 * 3. If status matches Excel, leaves it unchanged
 * 4. If status doesn't match, updates to match Excel (Approved, Rejected, or Pending_Approval)
 * 5. Does NOT change reviewer information or any other fields
 * 6. Creates a detailed report of all changes for rollback purposes
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const EXCEL_FILE_PATH = '/var/www/MyLogos/Vijay_Revised status with server Id_13th Feb.xlsx';
const VALID_STATUSES = ['Approved', 'Rejected', 'Pending_Approval'];
const REPORT_DIR = '/var/www/opine/backend/scripts/reports';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

/**
 * Normalize status to match MongoDB values
 */
const normalizeStatus = (status) => {
  if (!status) return null;
  const normalized = status.trim();
  // Map common variations
  if (normalized.toLowerCase() === 'pending') return 'Pending_Approval';
  if (normalized.toLowerCase() === 'pending approval') return 'Pending_Approval';
  if (normalized.toLowerCase() === 'approved') return 'Approved';
  if (normalized.toLowerCase() === 'rejected') return 'Rejected';
  return normalized;
};

/**
 * Read Excel file and extract Response IDs with Revised Status
 */
const readExcelData = () => {
  try {
    console.log('📖 Reading Excel file...');
    console.log(`   File: ${EXCEL_FILE_PATH}\n`);
    
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const responseMap = new Map(); // Map<responseId, revisedStatus>
    
    workbook.SheetNames.forEach((sheetName, index) => {
      console.log(`📋 Processing Sheet ${index + 1}: ${sheetName}`);
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      
      console.log(`   Found ${data.length} rows`);
      
      let validRows = 0;
      let invalidRows = 0;
      
      data.forEach((row, rowIndex) => {
        const responseId = row['Response ID'] || row['responseId'] || row['ResponseID'];
        const revisedStatus = row['Revised status'] || row['Revised Status'] || row['revisedStatus'] || row['revised_status'];
        
        if (!responseId) {
          invalidRows++;
          if (invalidRows <= 5) {
            console.log(`   ⚠️  Row ${rowIndex + 2}: Missing Response ID`);
          }
          return;
        }
        
        if (!revisedStatus) {
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
        
        // Store in map (if duplicate, last one wins)
        responseMap.set(responseId.trim(), normalizedStatus);
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
      .select('_id responseId status verificationData reviewAssignment')
      .lean();
      
      foundResponses.forEach(r => {
        responses.set(r.responseId, {
          _id: r._id.toString(),
          responseId: r.responseId,
          currentStatus: r.status,
          verificationData: r.verificationData || null,
          reviewAssignment: r.reviewAssignment || null
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
    const invalidStatus = [];
    
    responseMap.forEach((revisedStatus, responseId) => {
      const response = responses.get(responseId);
      
      if (!response) {
        notFound.push({
          responseId: responseId,
          revisedStatus: revisedStatus
        });
        return;
      }
      
      if (response.currentStatus === revisedStatus) {
        unchanged.push({
          responseId: responseId,
          _id: response._id,
          status: response.currentStatus
        });
        return;
      }
      
      // Status needs to be updated
      toUpdate.push({
        responseId: responseId,
        _id: response._id,
        currentStatus: response.currentStatus,
        revisedStatus: revisedStatus,
        verificationData: response.verificationData,
        reviewAssignment: response.reviewAssignment
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
    toUpdate.forEach(item => {
      const change = `${item.currentStatus} → ${item.revisedStatus}`;
      statusChanges[change] = (statusChanges[change] || 0) + 1;
    });
    
    console.log('📋 Status Changes Required:');
    Object.entries(statusChanges).forEach(([change, count]) => {
      console.log(`   ${change}: ${count}`);
    });
    console.log('');
    
    // Confirm before proceeding
    console.log('⚠️  About to update statuses for', toUpdate.length, 'responses.');
    console.log('   This will ONLY change the status field.');
    console.log('   Reviewer information and other fields will NOT be modified.\n');
    
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
        // Only update status field, preserve everything else
        const result = await SurveyResponse.updateOne(
          { _id: new mongoose.Types.ObjectId(item._id) },
          {
            $set: {
              status: item.revisedStatus,
              updatedAt: updateTimestamp
            }
          }
        );
        
        if (result.modifiedCount === 1) {
          successCount++;
          updatedData.push({
            responseId: item.responseId,
            _id: item._id,
            previousStatus: item.currentStatus,
            newStatus: item.revisedStatus,
            updatedAt: updateTimestamp.toISOString(),
            previousVerificationData: item.verificationData,
            previousReviewAssignment: item.reviewAssignment
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
    const reportPrefix = `response_status_update_${TIMESTAMP}`;
    
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
        errors: errorCount
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
        ['Response ID', 'MongoDB _id', 'Previous Status', 'New Status', 'Updated At'].join(',')
      ];
      
      updatedData.forEach(item => {
        csvRows.push([
          item.responseId,
          item._id,
          item.previousStatus,
          item.newStatus,
          item.updatedAt
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
 * Rollback Script for Response Status Updates
 * Generated: ${updateTimestamp.toISOString()}
 * 
 * This script reverts the status changes made by update_response_status_from_excel.js
 * Run: node ${path.basename(rollbackScriptPath)}
 */

const mongoose = require('mongoose');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const rollbackData = ${JSON.stringify(updatedData.map(item => ({
  _id: item._id,
  responseId: item.responseId,
  previousStatus: item.previousStatus,
  newStatus: item.newStatus
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
        const result = await SurveyResponse.updateOne(
          { _id: new mongoose.Types.ObjectId(item._id) },
          {
            $set: {
              status: item.previousStatus,
              updatedAt: new Date()
            }
          }
        );
        
        if (result.modifiedCount === 1) {
          successCount++;
        } else {
          errorCount++;
          console.error(\`❌ Failed to rollback \${item.responseId}\`);
        }
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

