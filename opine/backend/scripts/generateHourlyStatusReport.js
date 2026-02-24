#!/usr/bin/env node

/**
 * Generate Hourly Status Report for CATI Interviewers
 * 
 * This script generates an Excel report showing hourly counts of responses
 * for each CATI interviewer who worked on a specific date (IST).
 * 
 * Time ranges: Before 9, 9-10, 10-11, 11-12, 12-13, 13-14, 14-15, 15-16, 16-17, 17-18, 18-19, After 7
 * 
 * Dial = Count of responses with status: Approved, Pending_Approval, Rejected, Abandoned, Terminated
 * Completed = Count of responses with status: Pending_Approval, Rejected, Approved
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const TARGET_DATE = '2026-02-20'; // Format: YYYY-MM-DD (IST date)
const OUTPUT_DIR = '/var/www/opine/backend/data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Hourly status_new.xlsx');

// IST offset: UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Convert UTC date to IST date range
 */
function getISTDateRange(istDateString) {
  // Parse IST date (YYYY-MM-DD)
  const [year, month, day] = istDateString.split('-').map(Number);
  
  // Create IST date at 00:00:00
  const istStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Convert to UTC (subtract IST offset)
  const utcStart = new Date(istStart.getTime() - IST_OFFSET_MS);
  
  // Create IST date at 23:59:59.999
  const istEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  // Convert to UTC (subtract IST offset)
  const utcEnd = new Date(istEnd.getTime() - IST_OFFSET_MS);
  
  return { utcStart, utcEnd, istStart, istEnd };
}

/**
 * Get IST hour from UTC date
 */
function getISTHour(utcDate) {
  // Convert UTC to IST (add IST offset)
  const istDate = new Date(utcDate.getTime() + IST_OFFSET_MS);
  return istDate.getHours();
}

/**
 * Get time range label for a given IST hour (matching original format)
 */
function getTimeRangeLabel(hour) {
  if (hour < 9) return 'Before 9';
  if (hour >= 9 && hour < 10) return '9-10';
  if (hour >= 10 && hour < 11) return '10-11';
  if (hour >= 11 && hour < 12) return '11-12';
  if (hour >= 12 && hour < 13) return '12-1';  // 12 PM to 1 PM
  if (hour >= 13 && hour < 14) return '1-2';    // 1 PM to 2 PM
  if (hour >= 14 && hour < 15) return '2-3';    // 2 PM to 3 PM
  if (hour >= 15 && hour < 16) return '3-4';    // 3 PM to 4 PM
  if (hour >= 16 && hour < 17) return '4-5';    // 4 PM to 5 PM
  if (hour >= 17 && hour < 18) return '5-6';    // 5 PM to 6 PM
  if (hour >= 18 && hour < 19) return '6-7';    // 6 PM to 7 PM
  if (hour >= 19) return 'After 7';
  return 'Unknown';
}

/**
 * Check if status is in Dial category
 */
function isDialStatus(status) {
  return ['Approved', 'Pending_Approval', 'Rejected', 'abandoned', 'Terminated'].includes(status);
}

/**
 * Check if status is in Completed category
 */
function isCompletedStatus(status) {
  return ['Pending_Approval', 'Rejected', 'Approved'].includes(status);
}

/**
 * Main function
 */
async function generateHourlyStatusReport() {
  try {
    console.log('🚀 Starting Hourly Status Report Generation');
    console.log(`📅 Target Date (IST): ${TARGET_DATE}\n`);

    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000
    });
    console.log('✅ Connected to MongoDB\n');

    // Get IST date range
    const { utcStart, utcEnd } = getISTDateRange(TARGET_DATE);
    console.log(`📅 Date Range (UTC):`);
    console.log(`   From: ${utcStart.toISOString()}`);
    console.log(`   To: ${utcEnd.toISOString()}\n`);

    // Find all CATI responses for the target date
    console.log('🔍 Fetching CATI responses...');
    const responses = await SurveyResponse.find({
      interviewMode: 'cati',
      startTime: {
        $gte: utcStart,
        $lte: utcEnd
      },
      interviewer: { $exists: true, $ne: null }
    })
      .select('interviewer startTime status')
      .populate('interviewer', 'memberId firstName lastName phone')
      .lean();

    console.log(`✅ Found ${responses.length} CATI responses\n`);

    if (responses.length === 0) {
      console.log('⚠️  No responses found for the specified date.');
      await mongoose.disconnect();
      return;
    }

    // Group responses by interviewer and time range
    const interviewerData = new Map();

    responses.forEach(response => {
      if (!response.interviewer || !response.interviewer._id) return;

      const interviewerId = response.interviewer._id.toString();
      const istHour = getISTHour(response.startTime);
      const timeRange = getTimeRangeLabel(istHour);
      const status = response.status;

      if (!interviewerData.has(interviewerId)) {
        interviewerData.set(interviewerId, {
          interviewer: response.interviewer,
          timeRanges: new Map()
        });
      }

      const data = interviewerData.get(interviewerId);
      
      if (!data.timeRanges.has(timeRange)) {
        data.timeRanges.set(timeRange, {
          dial: 0,
          completed: 0
        });
      }

      const rangeData = data.timeRanges.get(timeRange);

      // Count Dial
      if (isDialStatus(status)) {
        rangeData.dial++;
      }

      // Count Completed
      if (isCompletedStatus(status)) {
        rangeData.completed++;
      }
    });

    console.log(`📊 Found ${interviewerData.size} unique interviewers\n`);

    // Define time ranges in order (matching original format)
    const timeRanges = [
      'Before 9',
      '9-10',
      '10-11',
      '11-12',
      '12-1',
      '1-2',
      '2-3',
      '3-4',
      '4-5',
      '5-6',
      '6-7',
      'After 7'
    ];

    // Prepare Excel data - matching original format exactly
    const excelData = [];

    // Row 1: Sno., Int ID, Name, then time ranges with empty cells between them
    // Note: Time ranges are in columns D, F, H, J, L, N, P, R, T, V, X, Z (every other column)
    const headerRow1 = [
      'Sno.',
      'Int ID',
      'Name',
      ...timeRanges.flatMap(range => [range, ''])
    ];
    excelData.push(headerRow1);

    // Row 2: Empty for first 3 columns, then Dial/Completed pairs for each time range
    const headerRow2 = [
      '',
      '',
      '',
      ...timeRanges.flatMap(() => ['Dial', 'Completed'])
    ];
    excelData.push(headerRow2);

    // Sort interviewers by memberId or name
    const sortedInterviewers = Array.from(interviewerData.values()).sort((a, b) => {
      const aId = a.interviewer.memberId || '';
      const bId = b.interviewer.memberId || '';
      return aId.localeCompare(bId);
    });

    // Add data rows for each interviewer
    sortedInterviewers.forEach(({ interviewer, timeRanges: ranges }, index) => {
      const row = [
        index + 1, // Sno.
        interviewer.memberId || 'N/A', // Int ID
        `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'Unknown' // Name
      ];

      // Add Dial and Completed counts for each time range (with empty cell between ranges)
      timeRanges.forEach(timeRange => {
        const rangeData = ranges.get(timeRange) || { dial: 0, completed: 0 };
        row.push(rangeData.dial);
        row.push(rangeData.completed);
      });

      excelData.push(row);
    });

    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(excelData);

    // Define yellow background style for headers (matching original)
    const headerStyle = {
      patternType: 'solid',
      fgColor: { rgb: 'FFFF00' },
      bgColor: { indexed: 64 }
    };

    // Initialize styles object in workbook if it doesn't exist
    if (!workbook.SSF) {
      workbook.SSF = {};
    }

    // Apply header styles to row 1 (headers) - ensure cells exist first
    for (let col = 0; col < excelData[0].length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!worksheet[cellRef]) {
        worksheet[cellRef] = { t: 's', v: excelData[0][col] || '' };
      }
      // Set style object
      worksheet[cellRef].s = JSON.parse(JSON.stringify(headerStyle));
    }

    // Apply header styles to row 2 (sub-headers)
    for (let col = 0; col < excelData[1].length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: 1, c: col });
      if (!worksheet[cellRef]) {
        worksheet[cellRef] = { t: 's', v: excelData[1][col] || '' };
      }
      // Set style object
      worksheet[cellRef].s = JSON.parse(JSON.stringify(headerStyle));
    }

    // Create merged cells for time range headers (row 1)
    // Each time range merges with the empty cell next to it
    // Starting from column D (index 3), every 2 columns
    const merges = [];
    let colIndex = 3; // Start at column D (after Sno., Int ID, Name)
    
    timeRanges.forEach(() => {
      // Merge time range name cell with empty cell next to it
      merges.push({
        s: { r: 0, c: colIndex },     // Start: row 0, column colIndex
        e: { r: 0, c: colIndex + 1 }  // End: row 0, column colIndex+1
      });
      colIndex += 2; // Move to next time range pair
    });
    
    worksheet['!merges'] = merges;

    // Set column widths (matching original format)
    worksheet['!cols'] = [
      { wch: 6 },  // Sno.
      { wch: 8 },  // Int ID
      { wch: 20 }, // Name
      ...timeRanges.flatMap(() => [{ wch: 8 }, { wch: 2 }, { wch: 8 }, { wch: 10 }]) // Time range name, empty (narrow), Dial, Completed
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write Excel file
    console.log(`💾 Writing Excel file...`);
    console.log(`   Path: ${OUTPUT_FILE}\n`);
    XLSX.writeFile(workbook, OUTPUT_FILE);

    console.log('✅ Hourly Status Report generated successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   Total Interviewers: ${sortedInterviewers.length}`);
    console.log(`   Total Responses: ${responses.length}`);
    console.log(`   Output File: ${OUTPUT_FILE}\n`);

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error generating report:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  generateHourlyStatusReport()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { generateHourlyStatusReport };

