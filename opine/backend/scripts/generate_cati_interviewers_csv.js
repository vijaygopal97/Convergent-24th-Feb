require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

async function generateCATIInterviewersCSV() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI not found in environment variables');
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Query CATI interviewers
    // CATI interviewers are those with userType 'interviewer' and interviewModes 'CATI' or 'Both'
    const catiInterviewers = await User.find({
      userType: 'interviewer',
      $or: [
        { interviewModes: 'CATI (Telephonic interview)' },
        { interviewModes: 'Both' }
      ],
      status: { $ne: 'deleted' } // Exclude deleted users
    })
    .select('memberId firstName lastName phone')
    .sort({ memberId: 1 })
    .lean();

    console.log(`Found ${catiInterviewers.length} CATI interviewers\n`);

    // Generate CSV
    const csvRows = [];
    
    // Header row
    csvRows.push('Serial Number,Member ID,Name,Phone Number');

    // Data rows
    catiInterviewers.forEach((interviewer, index) => {
      const serialNumber = index + 1;
      const memberId = interviewer.memberId || 'N/A';
      const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
      const phone = interviewer.phone || 'N/A';
      
      // Escape commas and quotes in CSV
      const escapeCSV = (field) => {
        if (field === 'N/A' || !field) return field;
        const str = String(field);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      csvRows.push(`${serialNumber},${escapeCSV(memberId)},${escapeCSV(name)},${escapeCSV(phone)}`);
    });

    // Write to file
    const csvContent = csvRows.join('\n');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `cati_interviewers_${timestamp}.csv`;
    const filepath = path.join(__dirname, '..', 'reports', filename);

    // Ensure reports directory exists
    const reportsDir = path.dirname(filepath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    fs.writeFileSync(filepath, csvContent, 'utf8');

    console.log('✅ CSV Generated Successfully!');
    console.log(`📄 File: ${filepath}`);
    console.log(`📊 Total Records: ${catiInterviewers.length}`);
    console.log(`\n📋 First 5 records preview:`);
    console.log('─'.repeat(60));
    csvRows.slice(0, 6).forEach(row => console.log(row));
    if (catiInterviewers.length > 5) {
      console.log(`... and ${catiInterviewers.length - 5} more records`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

generateCATIInterviewersCSV();
































