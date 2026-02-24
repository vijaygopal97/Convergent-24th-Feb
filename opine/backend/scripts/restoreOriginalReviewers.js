const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const EXCEL_FILE_PATH = '/var/www/reports/Vijay_CAPI & CATI_Server IDs for valid and Reject_5th Feb (1).xlsx';
const REVIEWER_EMAIL = 'ajayadarsh@gmail.com';
const TODAY = new Date('2026-02-06T00:00:00Z');

async function restoreOriginalReviewers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const ourReviewer = await User.findOne({ email: REVIEWER_EMAIL });
    if (!ourReviewer) {
      throw new Error(`Reviewer not found: ${REVIEWER_EMAIL}`);
    }

    // Find all responses updated today by ajayadarsh@gmail.com
    const updatedToday = await SurveyResponse.find({
      'verificationData.reviewer': ourReviewer._id,
      'verificationData.reviewedAt': { $gte: TODAY }
    }).select('responseId status verificationData createdAt updatedAt').lean();

    console.log(`\n📊 Found ${updatedToday.length} responses updated today by ${REVIEWER_EMAIL}`);

    // Load Excel to get the intended status
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const sheets = ['CATI', 'CAPI'];
    const excelData = new Map(); // responseId -> { status, sheet }

    for (const sheetName of sheets) {
      if (!workbook.Sheets[sheetName]) continue;
      
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });
      
      let responseIdCol = null;
      let statusCol = null;
      
      if (data.length > 0) {
        const firstRow = data[0];
        for (const key in firstRow) {
          const keyLower = key.toLowerCase().trim();
          if (keyLower.includes('response') && keyLower.includes('id')) {
            responseIdCol = key;
          }
          if (keyLower.includes('revised') && keyLower.includes('status')) {
            statusCol = key;
          }
        }
      }

      if (responseIdCol && statusCol) {
        data.forEach(row => {
          const responseId = row[responseIdCol]?.toString().trim();
          const status = row[statusCol]?.toString().trim();
          if (responseId && status) {
            excelData.set(responseId, { status: status.toLowerCase(), sheet: sheetName });
          }
        });
      }
    }

    console.log(`✅ Loaded ${excelData.size} responses from Excel`);

    // Unfortunately, we cannot recover the original reviewer information
    // because it was completely overwritten. However, we can:
    // 1. Set responses back to Pending_Approval so they can be re-reviewed
    // 2. Clear our reviewer information
    
    let restored = 0;
    let skipped = 0;
    const restoredIds = [];

    console.log('\n⚠️  WARNING: Original reviewer information cannot be recovered');
    console.log('   because it was completely overwritten. We will:');
    console.log('   1. Set responses back to Pending_Approval');
    console.log('   2. Clear verificationData so they can be re-reviewed');
    console.log('   3. Original quality agents will need to review them again\n');

    for (const response of updatedToday) {
      // Check if this response was created before today (meaning it existed before)
      const createdAt = new Date(response.createdAt);
      const wasCreatedBefore = createdAt < TODAY;

      if (wasCreatedBefore) {
        // This response existed before today, so it was likely already reviewed
        // We need to restore it by clearing our update
        
        try {
          // Get the intended status from Excel
          const excelInfo = excelData.get(response.responseId);
          const intendedStatus = excelInfo ? excelInfo.status : null;
          
          // Restore to Pending_Approval and clear verificationData
          // This allows the original quality agents to review them again
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                status: 'Pending_Approval',
                updatedAt: new Date()
              },
              $unset: {
                'verificationData.reviewer': '',
                'verificationData.reviewedAt': '',
                'verificationData.feedback': '',
                'verificationData.criteria': '',
                reviewAssignment: ''
              }
            }
          );
          
          restored++;
          restoredIds.push(response.responseId);
          
          if (restored % 100 === 0) {
            console.log(`   Restored ${restored} responses...`);
          }
        } catch (error) {
          console.error(`❌ Error restoring response ${response.responseId}:`, error.message);
        }
      } else {
        skipped++;
      }
    }

    console.log(`\n✅ Restoration Summary:`);
    console.log(`   Total restored to Pending_Approval: ${restored}`);
    console.log(`   Skipped (created today): ${skipped}`);
    console.log(`\n⚠️  IMPORTANT NOTES:`);
    console.log(`   1. Original reviewer information cannot be recovered`);
    console.log(`   2. Responses have been set back to Pending_Approval`);
    console.log(`   3. Original quality agents will need to review them again`);
    console.log(`   4. The Excel file data will be applied only to responses`);
    console.log(`      that are still Pending_Approval (using the fixed script)`);

    await mongoose.connection.close();
    console.log('\n✅ Restoration completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

restoreOriginalReviewers();






