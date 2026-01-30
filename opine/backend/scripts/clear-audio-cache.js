/**
 * Safely clear audio cache directory
 * This script checks the cache directory size and clears it safely
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../../uploads/audio-cache');

async function clearAudioCache() {
  try {
    console.log('🔍 Checking audio cache directory...\n');
    
    if (!fs.existsSync(CACHE_DIR)) {
      console.log('✅ Audio cache directory does not exist (nothing to clear)');
      console.log(`   Path: ${CACHE_DIR}\n`);
      return;
    }

    // Get directory stats
    const stats = fs.statSync(CACHE_DIR);
    if (!stats.isDirectory()) {
      console.log('⚠️  Path exists but is not a directory');
      return;
    }

    // List all files in cache
    const files = fs.readdirSync(CACHE_DIR);
    console.log(`📊 Found ${files.length} files in cache directory\n`);

    if (files.length === 0) {
      console.log('✅ Cache directory is empty (nothing to clear)\n');
      return;
    }

    // Calculate total size
    let totalSize = 0;
    const fileDetails = [];

    for (const file of files) {
      const filePath = path.join(CACHE_DIR, file);
      try {
        const fileStats = fs.statSync(filePath);
        if (fileStats.isFile()) {
          totalSize += fileStats.size;
          fileDetails.push({
            name: file,
            size: fileStats.size,
            modified: fileStats.mtime
          });
        }
      } catch (error) {
        console.warn(`⚠️  Error reading file ${file}: ${error.message}`);
      }
    }

    // Format size
    const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
    const sizeInGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 Audio Cache Directory Analysis');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Directory: ${CACHE_DIR}`);
    console.log(`   Total Files: ${fileDetails.length}`);
    console.log(`   Total Size: ${sizeInMB} MB (${sizeInGB} GB)`);
    console.log('═══════════════════════════════════════════════════════════\n');

    if (fileDetails.length === 0) {
      console.log('✅ No files to clear\n');
      return;
    }

    // Clear cache files
    console.log('🗑️  Clearing cache files...\n');
    let deletedCount = 0;
    let errorCount = 0;

    for (const file of fileDetails) {
      const filePath = path.join(CACHE_DIR, file.name);
      try {
        fs.unlinkSync(filePath);
        deletedCount++;
      } catch (error) {
        console.error(`❌ Error deleting ${file.name}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ Cache Clear Summary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`   Files Deleted: ${deletedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log(`   Space Freed: ${sizeInMB} MB (${sizeInGB} GB)`);
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('✅ Audio cache cleared successfully!\n');
  } catch (error) {
    console.error('❌ Error clearing audio cache:', error.message);
    process.exit(1);
  }
}

clearAudioCache();


