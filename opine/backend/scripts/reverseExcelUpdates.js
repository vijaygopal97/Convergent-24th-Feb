const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const EXCEL_FILE_PATH = '/var/www/reports/Vijay_CAPI & CATI_Server IDs for valid and Reject_5th Feb (1).xlsx';
const REVIEWER_EMAIL = 'ajayadarsh@gmail.com';
const TODAY = new Date('2026-02-06T00:00:00Z');

async function reverseUpdates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const reviewer = await User.findOne({ email: REVIEWER_EMAIL });
    if (!reviewer) {
      throw new Error(`Reviewer not found: ${REVIEWER_EMAIL}`);
    }

    // Find all responses that were updated today by ajayadarsh@gmail.com
    const updatedToday = await SurveyResponse.find({
      'verificationData.reviewer': reviewer._id,
      'verificationData.reviewedAt': { $gte: TODAY }
    }).select('responseId status verificationData createdAt').lean();

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

    // Now, for each response updated today, check if it was already Approved/Rejected before
    // We can't fully restore the original reviewer, but we can:
    // 1. Set status back to Pending_Approval if we can't determine original state
    // 2. Clear the verificationData for responses that were already processed
    
    let reversed = 0;
    let skipped = 0;
    const reversedIds = [];

    for (const response of updatedToday) {
      // Check if this response was created before today (meaning it existed before)
      const createdAt = new Date(response.createdAt);
      const wasCreatedBefore = createdAt < TODAY;

      if (wasCreatedBefore) {
        // This response existed before today, so it might have been already processed
        // We need to reverse the update by:
        // 1. Setting status back to Pending_Approval (we can't restore original status without history)
        // 2. Clearing verificationData (we can't restore original reviewer without history)
        
        try {
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
                reviewAssignment: ''
              }
            }
          );
          
          reversed++;
          reversedIds.push(response.responseId);
          
          if (reversed % 100 === 0) {
            console.log(`   Reversed ${reversed} responses...`);
          }
        } catch (error) {
          console.error(`❌ Error reversing response ${response.responseId}:`, error.message);
        }
      } else {
        skipped++;
      }
    }

    console.log(`\n✅ Reversal Summary:`);
    console.log(`   Total reversed: ${reversed}`);
    console.log(`   Skipped (created today): ${skipped}`);
    console.log(`\n⚠️  Note: We cannot restore the original reviewer information`);
    console.log(`   because it was overwritten. Responses have been set back to`);
    console.log(`   Pending_Approval status.`);

    await mongoose.connection.close();
    console.log('\n✅ Reversal completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

reverseUpdates();






