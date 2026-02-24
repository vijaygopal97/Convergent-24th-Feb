#!/usr/bin/env node

/**
 * Process a single AC Contact File with forced AC name
 * 
 * Usage: node process_single_ac.js <csv_path> <ac_name>
 * Example: node process_single_ac.js /var/www/opine/backend/data/ac280.csv "Asansol Dakshin"
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Constants
const OUTPUT_DIR = '/var/www/Report-Generation';
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const MAX_ROWS = 5000;

// Get command line arguments
const csvPath = process.argv[2];
const acName = process.argv[3];

if (!csvPath || !acName) {
  console.error('Usage: node process_single_ac.js <csv_path> <ac_name>');
  console.error('Example: node process_single_ac.js /var/www/opine/backend/data/ac280.csv "Asansol Dakshin"');
  process.exit(1);
}

// Extract AC code from filename (e.g., ac280.csv -> 280)
function extractACCode(filename) {
  const match = filename.match(/ac(\d+)\.csv$/i);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Convert CSV to CATI format Excel
 */
function convertCSVToExcel(csvPath, excelPath, acName) {
  console.log(`\n📝 Converting ${path.basename(csvPath)} to Excel with AC: ${acName}`);
  
  const cmd = `cd /var/www/Report-Generation && python3 convert_csv_to_cati_format.py "${csvPath}" "${excelPath}" "${acName}"`;
  
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`❌ Error converting ${csvPath}:`, error.message);
    return false;
  }
}

/**
 * Trim Excel file to MAX_ROWS rows (excluding header)
 */
function trimExcelToMaxRows(excelPath) {
  console.log(`\n✂️  Trimming Excel to ${MAX_ROWS} rows...`);
  
  try {
    const cmd = `cd /var/www/Report-Generation && python3 trim_excel.py "${excelPath}" ${MAX_ROWS}`;
    execSync(cmd, { stdio: 'inherit' });
    
    return true;
  } catch (error) {
    console.error(`❌ Error trimming Excel:`, error.message);
    return false;
  }
}

/**
 * Add contacts to survey using addContactsToSurvey.js
 */
function addContactsToSurvey(excelPath, acName) {
  console.log(`\n📤 Adding contacts to survey with AC: ${acName}`);
  
  const cmd = `cd /var/www/opine/backend && node scripts/addContactsToSurvey.js ${DEFAULT_SURVEY_ID} "${acName}" "${excelPath}"`;
  
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`❌ Error adding contacts to survey:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(70));
  console.log('SINGLE AC CONTACTS PROCESSING SCRIPT');
  console.log('='.repeat(70));
  console.log(`CSV File: ${csvPath}`);
  console.log(`AC Name: ${acName}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log(`Default Survey ID: ${DEFAULT_SURVEY_ID}`);
  console.log(`Max Rows per File: ${MAX_ROWS}`);
  console.log('='.repeat(70));
  
  // Check if CSV file exists
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found: ${csvPath}`);
    process.exit(1);
  }
  
  // Extract AC code from filename
  const filename = path.basename(csvPath);
  const acCode = extractACCode(filename);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing: ${filename}`);
  if (acCode) {
    console.log(`AC Code: ${acCode} (WB${acCode.toString().padStart(3, '0')})`);
  }
  console.log(`AC Name: ${acName}`);
  console.log(`${'='.repeat(70)}`);
  
  // Generate output Excel filename
  const excelFilename = acCode ? `ac${acCode}_output.xlsx` : `output_${Date.now()}.xlsx`;
  const excelPath = path.join(OUTPUT_DIR, excelFilename);
  
  // Step 1: Convert CSV to Excel
  const convertSuccess = convertCSVToExcel(csvPath, excelPath, acName);
  if (!convertSuccess) {
    console.error('❌ CSV conversion failed');
    process.exit(1);
  }
  
  // Step 2: Trim Excel to MAX_ROWS
  const trimSuccess = trimExcelToMaxRows(excelPath);
  if (!trimSuccess) {
    console.error('❌ Excel trimming failed');
    process.exit(1);
  }
  
  // Step 3: Add contacts to survey
  const addSuccess = addContactsToSurvey(excelPath, acName);
  if (!addSuccess) {
    console.error('❌ Adding contacts to survey failed');
    process.exit(1);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(70));
  console.log(`✅ Successfully processed ${filename}`);
  console.log(`✅ AC Name: ${acName}`);
  console.log(`✅ Output Excel: ${excelFilename}`);
  console.log('='.repeat(70));
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };








