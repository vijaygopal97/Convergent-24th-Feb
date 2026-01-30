/**
 * Force update AvailableAssignment Materialized View
 * This will clean up stale entries and refresh the view
 */

require('dotenv').config();
const mongoose = require('mongoose');
const updateAvailableAssignments = require('../jobs/updateAvailableAssignments');

async function forceUpdate() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('🔄 Forcing update of AvailableAssignment materialized view...\n');
    await updateAvailableAssignments();
    
    console.log('\n✅ Update complete!');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

forceUpdate();


