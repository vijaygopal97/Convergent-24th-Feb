#!/usr/bin/env node

/**
 * Generate Hourly Status Report for CATI Interviewers
 * Uses template file to preserve exact formatting (colors, borders, merged cells)
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
const TEMPLATE_FILE = '/var/www/opine/backend/data/Hourly status (1).xlsx';
const OUTPUT_DIR = '/var/www/opine/backend/data';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Hourly status_new.xlsx');

// IST offset: UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Convert UTC date to IST date range
 */
function getISTDateRange(istDateString) {
  const [year, month, day] = istDateString.split('-').map(Number);
  const istStart = new Date(year, month - 1, day, 0, 0, 0, 0);
  const utcStart = new Date(istStart.getTime() - IST_OFFSET_MS);
  const istEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
  const utcEnd = new Date(istEnd.getTime() - IST_OFFSET_MS);
  return { utcStart, utcEnd };
}

/**
 * Get IST hour from UTC date
 */
function getISTHour(utcDate) {
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
  if (hour >= 12 && hour < 13) return '12-1';
  if (hour >= 13 && hour < 14) return '1-2';
  if (hour >= 14 && hour < 15) return '2-3';
  if (hour >= 15 && hour < 16) return '3-4';
  if (hour >= 16 && hour < 17) return '4-5';
  if (hour >= 17 && hour < 18) return '5-6';
  if (hour >= 18 && hour < 19) return '6-7';
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
    console.log('🚀 Starting Hourly Status Report Generation (Using Template)');
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

      if (isDialStatus(status)) {
        rangeData.dial++;
      }

      if (isCompletedStatus(status)) {
        rangeData.completed++;
      }
    });

    console.log(`📊 Found ${interviewerData.size} unique interviewers\n`);

    // Define time ranges in order (matching template)
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

    // Read template file
    console.log('📖 Reading template file...');
    if (!fs.existsSync(TEMPLATE_FILE)) {
      throw new Error(`Template file not found: ${TEMPLATE_FILE}`);
    }

    const template = XLSX.readFile(TEMPLATE_FILE, { cellStyles: true });
    const templateSheetName = template.SheetNames[0];
    const templateWs = template.Sheets[templateSheetName];
    const templateData = XLSX.utils.sheet_to_json(templateWs, { header: 1, defval: '' });

    console.log(`✅ Template loaded: ${templateSheetName}\n`);

    // Create new workbook from template (preserves all formatting)
    const workbook = XLSX.utils.book_new();
    const worksheet = JSON.parse(JSON.stringify(templateWs)); // Deep copy to preserve styles

    // Clear data rows (keep header rows 1 and 2)
    const dataStartRow = 2; // Row 3 (0-indexed = 2)
    const maxRow = templateData.length;
    
    // Remove old data rows
    for (let row = dataStartRow; row < maxRow; row++) {
      for (let col = 0; col < 27; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        delete worksheet[cellRef];
      }
    }

    // Sort interviewers by memberId
    const sortedInterviewers = Array.from(interviewerData.values()).sort((a, b) => {
      const aId = a.interviewer.memberId || '';
      const bId = b.interviewer.memberId || '';
      return aId.localeCompare(bId);
    });

    // Write data rows starting from row 3 (index 2)
    sortedInterviewers.forEach(({ interviewer, timeRanges: ranges }, index) => {
      const rowIndex = dataStartRow + index;
      
      // Set Sno., Int ID, Name
      templateWs[XLSX.utils.encode_cell({ r: rowIndex, c: 0 })] = { t: 'n', v: index + 1 };
      templateWs[XLSX.utils.encode_cell({ r: rowIndex, c: 1 })] = { t: 'n', v: parseInt(interviewer.memberId) || 0 };
      templateWs[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })] = { 
        t: 's', 
        v: `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'Unknown' 
      };

      // Write Dial and Completed for each time range
      // Data columns: D=3, E=4, F=5, G=6, H=7, I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15, Q=16, R=17, S=18, T=19, U=20, V=21, W=22, X=23, Y=24, Z=25, AA=26
      // Pattern: For each time range, Dial is at colIndex, Completed is at colIndex+1
      let colIndex = 3; // Start at column D
      
      timeRanges.forEach(timeRange => {
        const rangeData = ranges.get(timeRange) || { dial: 0, completed: 0 };
        
        // Dial column
        templateWs[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })] = { t: 'n', v: rangeData.dial };
        // Completed column
        templateWs[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex + 1 })] = { t: 'n', v: rangeData.completed };
        
        colIndex += 2; // Move to next time range pair
      });
    });

    // Update workbook with modified worksheet
    template.Sheets[templateSheetName] = templateWs;

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Write Excel file (preserving styles from template)
    console.log(`💾 Writing Excel file...`);
    console.log(`   Path: ${OUTPUT_FILE}\n`);
    XLSX.writeFile(template, OUTPUT_FILE, { cellStyles: true });

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

