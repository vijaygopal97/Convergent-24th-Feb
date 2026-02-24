const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const EXCEL_FILE_PATH = '/var/www/reports/Vijay_CAPI & CATI_Server IDs for valid and Reject_5th Feb (1).xlsx';
const REVIEWER_EMAIL = 'ajayadarsh@gmail.com';
const REJECTION_REASON = 'Manual Rejection on 6 feb 2026';

async function updateResponsesFromExcel() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the reviewer user
    const reviewer = await User.findOne({ email: REVIEWER_EMAIL });
    if (!reviewer) {
      throw new Error(`Reviewer not found: ${REVIEWER_EMAIL}`);
    }
    console.log(`✅ Found reviewer: ${REVIEWER_EMAIL} (ID: ${reviewer._id})`);

    // Load Excel file
    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    console.log('✅ Loaded Excel file');
    console.log(`   Sheets: ${workbook.SheetNames.join(', ')}`);

    const sheets = ['CATI', 'CAPI'];
    let totalProcessed = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalNotFound = 0;
    let totalErrors = 0;
    const notFoundIds = [];
    const errorIds = [];

    for (const sheetName of sheets) {
      console.log(`\n📊 Processing sheet: ${sheetName}`);
      
      if (!workbook.Sheets[sheetName]) {
        console.log(`⚠️  Sheet ${sheetName} not found, skipping...`);
        continue;
      }

      // Convert sheet to JSON
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });
      
      if (!data || data.length === 0) {
        console.log(`⚠️  Sheet ${sheetName} is empty, skipping...`);
        continue;
      }

      // Find column names (handle case variations)
      let responseIdCol = null;
      let statusCol = null;
      
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

      if (!responseIdCol || !statusCol) {
        console.log(`⚠️  Could not find required columns in sheet ${sheetName}, skipping...`);
        console.log(`   Available columns: ${Object.keys(firstRow).join(', ')}`);
        continue;
      }

      console.log(`   Found columns: Response ID = "${responseIdCol}", Status = "${statusCol}"`);
      console.log(`   Total rows: ${data.length}`);

      // Process each row
      let sheetProcessed = 0;
      let sheetApproved = 0;
      let sheetRejected = 0;
      let sheetNotFound = 0;
      let sheetErrors = 0;

      for (const row of data) {
        const responseId = row[responseIdCol]?.toString().trim();
        const status = row[statusCol]?.toString().trim();

        if (!responseId || !status) {
          continue; // Skip empty rows
        }

        // Normalize status
        const normalizedStatus = status.toLowerCase();
        if (normalizedStatus !== 'approved' && normalizedStatus !== 'rejected') {
          console.log(`⚠️  Invalid status "${status}" for response ${responseId}, skipping...`);
          continue;
        }

        try {
          // Find the response
          const response = await SurveyResponse.findOne({ responseId: responseId });

          if (!response) {
            console.log(`❌ Response not found: ${responseId}`);
            notFoundIds.push(responseId);
            sheetNotFound++;
            totalNotFound++;
            continue;
          }

          // ⚠️ CRITICAL: Only update status from Excel, preserve existing reviewer if it exists
          // If response already has a reviewer, keep it - don't overwrite
          // Only update responses that are in the Excel file
          const existingReviewer = response.verificationData?.reviewer;
          const hasExistingReviewer = existingReviewer && existingReviewer.toString();

          // Prepare update data - only update status
          const updateData = {
            $set: {
              status: normalizedStatus === 'approved' ? 'Approved' : 'Rejected',
              updatedAt: new Date()
            },
            $unset: {
              reviewAssignment: ''
            }
          };

          // Only set reviewer if it doesn't already exist
          if (!hasExistingReviewer) {
            updateData.$set['verificationData.reviewer'] = reviewer._id;
            updateData.$set['verificationData.reviewedAt'] = new Date();
          }
          // If reviewer exists, preserve it and only update reviewedAt if needed
          else {
            // Preserve existing reviewer - don't change it
            // Only update reviewedAt if it doesn't exist
            if (!response.verificationData?.reviewedAt) {
              updateData.$set['verificationData.reviewedAt'] = new Date();
            }
          }

          // Add rejection reason if rejected (only if not already set)
          if (normalizedStatus === 'rejected') {
            if (!response.verificationData?.feedback || 
                response.verificationData.feedback === REJECTION_REASON) {
              updateData.$set['verificationData.feedback'] = REJECTION_REASON;
            }
            // If feedback exists and is different, preserve it
          } else {
            // For approved, only set empty feedback if none exists
            if (!response.verificationData?.feedback) {
              updateData.$set['verificationData.feedback'] = '';
            }
          }

          // Preserve existing verification criteria if they exist
          if (response.verificationData?.criteria) {
            updateData.$set['verificationData.criteria'] = response.verificationData.criteria;
          }
          
          // Preserve all other existing verificationData fields
          if (response.verificationData) {
            // Preserve reviewHistory if it exists
            if (response.verificationData.reviewHistory) {
              updateData.$set['verificationData.reviewHistory'] = response.verificationData.reviewHistory;
            }
            // Preserve originalReviewer if it exists
            if (response.verificationData.originalReviewer) {
              updateData.$set['verificationData.originalReviewer'] = response.verificationData.originalReviewer;
            }
            // Preserve previousReviewer if it exists
            if (response.verificationData.previousReviewer) {
              updateData.$set['verificationData.previousReviewer'] = response.verificationData.previousReviewer;
            }
          }

          // Update the response
          const updatedResponse = await SurveyResponse.findOneAndUpdate(
            { _id: response._id },
            updateData,
            { new: true, runValidators: false }
          );

          if (updatedResponse) {
            if (normalizedStatus === 'approved') {
              sheetApproved++;
              totalApproved++;
            } else {
              sheetRejected++;
              totalRejected++;
            }
            sheetProcessed++;
            totalProcessed++;

            if (sheetProcessed % 100 === 0) {
              console.log(`   Processed ${sheetProcessed} responses...`);
            }
          } else {
            console.log(`❌ Failed to update response: ${responseId}`);
            errorIds.push(responseId);
            sheetErrors++;
            totalErrors++;
          }
        } catch (error) {
          console.error(`❌ Error processing response ${responseId}:`, error.message);
          errorIds.push(responseId);
          sheetErrors++;
          totalErrors++;
        }
      }

      console.log(`\n✅ Sheet ${sheetName} completed:`);
      console.log(`   Total processed: ${sheetProcessed}`);
      console.log(`   Approved: ${sheetApproved}`);
      console.log(`   Rejected: ${sheetRejected}`);
      console.log(`   Not found: ${sheetNotFound}`);
      console.log(`   Errors: ${sheetErrors}`);
    }

    console.log(`\n📊 ===== FINAL SUMMARY =====`);
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Total approved: ${totalApproved}`);
    console.log(`Total rejected: ${totalRejected}`);
    console.log(`Total not found: ${totalNotFound}`);
    console.log(`Total errors: ${totalErrors}`);

    if (notFoundIds.length > 0) {
      console.log(`\n⚠️  Not found response IDs (first 20):`);
      console.log(notFoundIds.slice(0, 20).join(', '));
      if (notFoundIds.length > 20) {
        console.log(`   ... and ${notFoundIds.length - 20} more`);
      }
    }

    if (errorIds.length > 0) {
      console.log(`\n⚠️  Error response IDs (first 20):`);
      console.log(errorIds.slice(0, 20).join(', '));
      if (errorIds.length > 20) {
        console.log(`   ... and ${errorIds.length - 20} more`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
updateResponsesFromExcel();
