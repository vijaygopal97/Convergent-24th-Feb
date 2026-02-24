#!/usr/bin/env node

/**
 * Reset passwords for specific users to their phone numbers
 * 
 * This script:
 * 1. Finds users by member ID
 * 2. Resets their passwords to their current phone numbers
 * 3. Uses bcrypt with salt rounds of 12 (matching User model pre-save hook)
 * 4. Verifies passwords work correctly
 * 
 * Usage: node scripts/reset_passwords_to_phone.js <memberId1> <memberId2> ...
 * Example: node scripts/reset_passwords_to_phone.js 8019 8044 8013
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

/**
 * Reset password for a user to their phone number
 */
async function resetPasswordToPhone(memberId) {
  try {
    // Find user by member ID
    const user = await User.findOne({ memberId: String(memberId) });
    
    if (!user) {
      return {
        success: false,
        memberId,
        error: `User with member ID ${memberId} not found`
      };
    }

    // Get phone number (normalize it - remove country code if present)
    let phoneNumber = user.phone.replace(/^\+91/, '').replace(/^91/, '').trim();
    
    if (!phoneNumber || phoneNumber.length === 0) {
      return {
        success: false,
        memberId,
        name: `${user.firstName} ${user.lastName}`,
        error: `User ${memberId} has no phone number`
      };
    }

    console.log(`\n📱 Processing: ${memberId} (${user.firstName} ${user.lastName})`);
    console.log(`   Current phone: ${user.phone}`);
    console.log(`   Normalized phone (will be password): ${phoneNumber}`);

    // Hash password using bcrypt with salt rounds of 12 (matching User model)
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(phoneNumber, salt);

    // Update password directly using updateOne (bypasses pre-save hook)
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    // Verify password works
    const updatedUser = await User.findById(user._id).select('+password');
    const passwordValid = await updatedUser.comparePassword(phoneNumber);

    if (!passwordValid) {
      return {
        success: false,
        memberId,
        name: `${user.firstName} ${user.lastName}`,
        error: 'Password verification failed after reset'
      };
    }

    console.log(`   ✅ Password reset successful and verified`);

    return {
      success: true,
      memberId,
      name: `${user.firstName} ${user.lastName}`,
      phone: user.phone,
      normalizedPhone: phoneNumber
    };

  } catch (error) {
    return {
      success: false,
      memberId,
      error: error.message
    };
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Parse command line arguments
    const memberIds = process.argv.slice(2);

    if (memberIds.length === 0) {
      console.error('❌ Error: At least one member ID is required');
      console.error('\nUsage: node scripts/reset_passwords_to_phone.js <memberId1> <memberId2> ...');
      console.error('\nExample:');
      console.error('  node scripts/reset_passwords_to_phone.js 8019 8044 8013');
      process.exit(1);
    }

    console.log('='.repeat(70));
    console.log('RESET PASSWORDS TO PHONE NUMBERS');
    console.log('='.repeat(70));
    console.log(`Member IDs to process: ${memberIds.join(', ')}`);
    console.log('='.repeat(70));

    // Connect to MongoDB
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Process each user
    console.log('\n' + '='.repeat(70));
    console.log('PROCESSING PASSWORD RESETS');
    console.log('='.repeat(70));

    const results = {
      successful: [],
      failed: []
    };

    for (const memberId of memberIds) {
      const result = await resetPasswordToPhone(memberId);
      
      if (result.success) {
        results.successful.push(result);
      } else {
        results.failed.push(result);
      }
    }

    // Print summary
    console.log('\n\n' + '='.repeat(70));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(70));
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);

    if (results.successful.length > 0) {
      console.log('\n✅ Successfully reset passwords:');
      results.successful.forEach(r => {
        console.log(`  ${r.memberId} (${r.name}): Password set to phone ${r.normalizedPhone}`);
      });
    }

    if (results.failed.length > 0) {
      console.log('\n❌ Failed password resets:');
      results.failed.forEach(f => {
        console.log(`  ${f.memberId}${f.name ? ` (${f.name})` : ''}: ${f.error}`);
      });
    }

    console.log('='.repeat(70));

    await mongoose.connection.close();
    console.log('\n✅ MongoDB connection closed');

    process.exit(results.failed.length > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { resetPasswordToPhone, main };
