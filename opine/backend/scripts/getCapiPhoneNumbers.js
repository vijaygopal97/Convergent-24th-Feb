#!/usr/bin/env node

/**
 * Script to read CAPI IDs from Excel, prefix "CAPI", and get phone numbers from database
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

async function getCapiPhoneNumbers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Read Excel file
    const excelPath = '/var/www/MyLogos/KrishnaFiles/CAPI ID.xlsx';
    console.log(`\n📖 Reading Excel file: ${excelPath}`);
    
    if (!fs.existsSync(excelPath)) {
      throw new Error(`Excel file not found: ${excelPath}`);
    }

    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    console.log(`✅ Read ${data.length} rows from Excel`);
    
    // Extract IDs (assuming they're in the first column)
    const ids = data
      .map(row => row[0])
      .filter(id => id !== null && id !== undefined && id !== '')
      .map(id => String(id).trim());
    
    console.log(`📋 Found ${ids.length} IDs to process`);
    
    // Create member IDs by prefixing "CAPI"
    const memberIds = ids.map(id => `CAPI${id}`);
    
    console.log(`\n🔍 Searching database for ${memberIds.length} member IDs...`);
    
    // Query database for users with these member IDs
    const users = await User.find({
      memberId: { $in: memberIds }
    }).select('memberId phone firstName lastName email').lean();
    
    console.log(`✅ Found ${users.length} users in database`);
    
    // Create a map for quick lookup
    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user.memberId, user);
    });
    
    // Prepare output data
    const outputData = [];
    
    // Add header row
    outputData.push(['Original ID', 'Member ID', 'Phone Number', 'First Name', 'Last Name', 'Email', 'Status']);
    
    // Process each ID
    let foundCount = 0;
    let notFoundCount = 0;
    
    for (let i = 0; i < ids.length; i++) {
      const originalId = ids[i];
      const memberId = memberIds[i];
      const user = userMap.get(memberId);
      
      if (user) {
        outputData.push([
          originalId,
          memberId,
          user.phone || 'N/A',
          user.firstName || 'N/A',
          user.lastName || 'N/A',
          user.email || 'N/A',
          'Found'
        ]);
        foundCount++;
      } else {
        outputData.push([
          originalId,
          memberId,
          'NOT FOUND',
          'NOT FOUND',
          'NOT FOUND',
          'NOT FOUND',
          'Not Found'
        ]);
        notFoundCount++;
      }
    }
    
    console.log(`\n📊 Results:`);
    console.log(`   Found: ${foundCount}`);
    console.log(`   Not Found: ${notFoundCount}`);
    
    // Create output Excel file
    const outputPath = '/var/www/MyLogos/KrishnaFiles/CAPI_ID_with_Phone_Numbers.xlsx';
    console.log(`\n💾 Creating output file: ${outputPath}`);
    
    // Create new workbook
    const outputWorkbook = XLSX.utils.book_new();
    const outputWorksheet = XLSX.utils.aoa_to_sheet(outputData);
    
    // Set column widths
    const colWidths = [
      { wch: 15 }, // Original ID
      { wch: 15 }, // Member ID
      { wch: 20 }, // Phone Number
      { wch: 20 }, // First Name
      { wch: 20 }, // Last Name
      { wch: 30 }, // Email
      { wch: 15 }  // Status
    ];
    outputWorksheet['!cols'] = colWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(outputWorkbook, outputWorksheet, 'CAPI IDs with Phone Numbers');
    
    // Write file
    XLSX.writeFile(outputWorkbook, outputPath);
    
    console.log(`✅ Output file created: ${outputPath}`);
    
    // Also create a summary
    console.log(`\n📋 Summary:`);
    console.log(`   Total IDs processed: ${ids.length}`);
    console.log(`   Found in database: ${foundCount}`);
    console.log(`   Not found: ${notFoundCount}`);
    
    // Show first few found entries
    if (foundCount > 0) {
      console.log(`\n📱 Sample entries (first 5):`);
      const foundEntries = outputData.slice(1).filter(row => row[6] === 'Found').slice(0, 5);
      foundEntries.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row[1]} - ${row[2]} (${row[3]} ${row[4]})`);
      });
    }
    
    // Show not found entries
    if (notFoundCount > 0) {
      console.log(`\n⚠️  Not found entries (first 5):`);
      const notFoundEntries = outputData.slice(1).filter(row => row[6] === 'Not Found').slice(0, 5);
      notFoundEntries.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row[1]}`);
      });
    }
    
    await mongoose.connection.close();
    console.log(`\n✅ Done!`);
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
getCapiPhoneNumbers();

