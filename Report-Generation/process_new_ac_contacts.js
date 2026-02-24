#!/usr/bin/env node

/**
 * Process AC Contact Files from 1-new folder
 * 
 * This script processes all CSV files in the newcontacts/1-new folder:
 * 1. Extracts AC code from filename (e.g., ac33.csv -> 33)
 * 2. Looks up AC name from assemblyConstituencies.json (WB033)
 * 3. Converts CSV to CATI format Excel with correct AC name
 * 4. Trims output to 5000 rows
 * 5. Adds contacts to default survey using addContactsToSurvey.js
 * 6. Generates summary JSON with all processed ACs
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

// Constants
const NEWCONTACTS_DIR = '/var/www/Report-Generation/newcontacts/1-new';
const OUTPUT_DIR = '/var/www/Report-Generation';
const AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json';
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const MAX_ROWS = 5000;

/**
 * Load assembly constituencies JSON
 */
function loadACJson() {
  const data = JSON.parse(fs.readFileSync(AC_JSON_PATH, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  
  // Create a map: acCode -> acName
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  
  return acMap;
}

/**
 * Extract AC code from filename (e.g., ac33.csv -> 33)
 */
function extractACCode(filename) {
  const match = filename.match(/^ac(\d+)\.csv$/i);
  if (!match) {
    return null;
  }
  return parseInt(match[1], 10);
}

/**
 * Format AC code for JSON lookup (e.g., 33 -> WB033, 3 -> WB003)
 */
function formatACCodeForLookup(acCode) {
  return `WB${acCode.toString().padStart(3, '0')}`;
}

/**
 * Find AC name from JSON
 */
function findACName(acCode, acMap) {
  const lookupCode = formatACCodeForLookup(acCode);
  const acName = acMap[lookupCode];
  
  if (!acName) {
    throw new Error(`AC name not found for code: ${lookupCode} (from ac${acCode}.csv)`);
  }
  
  return acName;
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
 * Process a single CSV file
 */
async function processACFile(csvFilename, acMap) {
  const csvPath = path.join(NEWCONTACTS_DIR, csvFilename);
  
  // Extract AC code
  const acCode = extractACCode(csvFilename);
  if (!acCode) {
    console.log(`⚠️  Skipping ${csvFilename}: Invalid filename format`);
    return { success: false, error: 'Invalid filename format', acCode: null, acName: null };
  }
  
  // Find AC name
  let acName;
  try {
    acName = findACName(acCode, acMap);
  } catch (error) {
    console.log(`⚠️  ${error.message}`);
    return { success: false, error: error.message, acCode, acName: null };
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Processing: ${csvFilename}`);
  console.log(`AC Code: ${acCode} (${formatACCodeForLookup(acCode)})`);
  console.log(`AC Name: ${acName}`);
  console.log(`${'='.repeat(70)}`);
  
  // Generate output Excel filename
  const excelFilename = `ac${acCode}_output.xlsx`;
  const excelPath = path.join(OUTPUT_DIR, excelFilename);
  
  // Step 1: Convert CSV to Excel
  const convertSuccess = convertCSVToExcel(csvPath, excelPath, acName);
  if (!convertSuccess) {
    return { success: false, error: 'CSV conversion failed', acCode, acName };
  }
  
  // Step 2: Trim Excel to MAX_ROWS
  const trimSuccess = trimExcelToMaxRows(excelPath);
  if (!trimSuccess) {
    return { success: false, error: 'Excel trimming failed', acCode, acName };
  }
  
  // Step 3: Add contacts to survey
  const addSuccess = addContactsToSurvey(excelPath, acName);
  if (!addSuccess) {
    return { success: false, error: 'Adding contacts to survey failed', acCode, acName };
  }
  
  return {
    success: true,
    acCode,
    acCodeFormatted: formatACCodeForLookup(acCode),
    acName,
    csvFile: csvFilename,
    excelFile: excelFilename
  };
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(70));
  console.log('PROCESS AC CONTACTS FROM 1-NEW FOLDER');
  console.log('='.repeat(70));
  console.log(`New Contacts Directory: ${NEWCONTACTS_DIR}`);
  console.log(`Output Directory: ${OUTPUT_DIR}`);
  console.log(`Default Survey ID: ${DEFAULT_SURVEY_ID}`);
  console.log(`Max Rows per File: ${MAX_ROWS}`);
  console.log('='.repeat(70));
  
  // Load AC JSON
  console.log('\n📖 Loading Assembly Constituencies JSON...');
  const acMap = loadACJson();
  console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings`);
  
  // List all CSV files
  console.log(`\n📂 Scanning ${NEWCONTACTS_DIR} for CSV files...`);
  const files = await fsPromises.readdir(NEWCONTACTS_DIR);
  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv') && f.toLowerCase().startsWith('ac'));
  csvFiles.sort(); // Sort for consistent processing order
  
  console.log(`✅ Found ${csvFiles.length} CSV files to process`);
  
  if (csvFiles.length === 0) {
    console.log('❌ No CSV files found. Exiting.');
    process.exit(1);
  }
  
  // Process each file
  const results = [];
  const startTime = Date.now();
  
  for (let i = 0; i < csvFiles.length; i++) {
    const csvFile = csvFiles[i];
    console.log(`\n\n[${i + 1}/${csvFiles.length}] Processing: ${csvFile}`);
    
    try {
      const result = await processACFile(csvFile, acMap);
      results.push({
        ...result,
        processedAt: new Date().toISOString()
      });
      
      if (result.success) {
        console.log(`\n✅ Successfully processed ${csvFile}`);
      } else {
        console.log(`\n❌ Failed to process ${csvFile}: ${result.error}`);
      }
    } catch (error) {
      console.error(`\n❌ Unexpected error processing ${csvFile}:`, error);
      results.push({
        success: false,
        error: error.message,
        csvFile,
        processedAt: new Date().toISOString()
      });
    }
  }
  
  // Generate summary
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const summary = {
    generatedAt: new Date().toISOString(),
    totalFiles: csvFiles.length,
    successful: successful.length,
    failed: failed.length,
    durationSeconds: duration,
    defaultSurveyId: DEFAULT_SURVEY_ID,
    maxRowsPerFile: MAX_ROWS,
    processedACs: successful.map(r => ({
      acCode: r.acCode,
      acCodeFormatted: r.acCodeFormatted,
      acName: r.acName,
      csvFile: r.csvFile,
      excelFile: r.excelFile,
      processedAt: r.processedAt
    })),
    failedFiles: failed.map(r => ({
      csvFile: r.csvFile,
      error: r.error,
      acCode: r.acCode,
      acName: r.acName,
      processedAt: r.processedAt
    }))
  };
  
  // Save summary JSON
  const summaryPath = path.join(OUTPUT_DIR, `ac_contacts_processing_1new_summary_${Date.now()}.json`);
  await fsPromises.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  
  // Print final summary
  console.log('\n\n' + '='.repeat(70));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(70));
  console.log(`Total Files: ${csvFiles.length}`);
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`\n📊 Summary JSON saved to: ${summaryPath}`);
  
  if (successful.length > 0) {
    console.log(`\n✅ Successfully Processed ACs:`);
    successful.forEach(r => {
      console.log(`  - ${r.acCodeFormatted}: ${r.acName}`);
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed Files:`);
    failed.forEach(r => {
      console.log(`  - ${r.csvFile}: ${r.error}`);
    });
  }
  
  console.log('\n' + '='.repeat(70));
  
  // Exit with error code if any failed
  process.exit(failed.length > 0 ? 1 : 0);
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main, processACFile, loadACJson, extractACCode, formatACCodeForLookup, findACName };






















































