/**
 * Reset Cloud Telephony Registration for an Interviewer
 * 
 * This script resets the Cloud Telephony registration status for a user,
 * allowing them to be re-registered when they start their next CATI interview.
 * 
 * Usage: node scripts/resetCloudTelephonyRegistration.js <phoneNumber>
 * Example: node scripts/resetCloudTelephonyRegistration.js 9958011332
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const CatiAgent = require('../models/CatiAgent');
const { invalidateCachedRegistrationStatus } = require('../utils/catiAgentCache');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
};


const resetRegistration = async (phoneNumber) => {
  try {
    // Normalize phone number
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const phoneVariations = [
      cleanPhone,
      '+' + cleanPhone,
      '+91' + cleanPhone,
      '91' + cleanPhone
    ];
    
    console.log('\n🔍 Searching for users with phone:', phoneVariations[0]);
    
    // Find ALL users with this phone number (CRITICAL FIX: Use find() instead of findOne())
    const users = await User.find({ 
      $or: phoneVariations.map(p => ({ phone: p }))
    }).select('_id firstName lastName email phone memberId').lean();
    
    if (!users || users.length === 0) {
      console.log('❌ No users found with phone:', phoneNumber);
      console.log('   Please check the phone number and try again.');
      return false;
    }
    
    console.log(`✅ Found ${users.length} user(s) with this phone number:\n`);
    
    let resetCount = 0;
    let skippedCount = 0;
    
    // Reset registration for ALL users with this phone number
    for (const user of users) {
      console.log(`📋 Processing user: ${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A');
      console.log('   ID:', user._id);
      console.log('   Email:', user.email);
      console.log('   Phone:', user.phone);
      
      // Find CatiAgent record for this specific user
      const agent = await CatiAgent.findOne({ user: user._id, phone: cleanPhone });
      
      if (!agent) {
        console.log('   ⚠️  No CatiAgent record found - skipping');
        skippedCount++;
        console.log('');
        continue;
      }
      
      console.log('   📋 Current CatiAgent status:');
      console.log('      Registered:', agent.providers?.cloudtelephony?.registered || false);
      console.log('      Registered At:', agent.providers?.cloudtelephony?.registeredAt || 'N/A');
      console.log('      Agent ID:', agent.providers?.cloudtelephony?.agentId || 'N/A');
      
      // Reset registration
      if (agent.providers?.cloudtelephony) {
        const wasRegistered = agent.providers.cloudtelephony.registered === true;
        
        agent.providers.cloudtelephony.registered = false;
        agent.providers.cloudtelephony.registeredAt = null;
        agent.providers.cloudtelephony.agentId = null;
        agent.providers.cloudtelephony.lastChecked = null;
        agent.markModified('providers');
        await agent.save();
        
        console.log('   ✅ RESET COMPLETE:');
        console.log('      CloudTelephony Registered: false');
        console.log('      Registered At: cleared');
        console.log('      Agent ID: cleared');
        console.log('      Last Checked: cleared');
        
        if (wasRegistered) {
          console.log('      📝 Status changed from registered to unregistered.');
          resetCount++;
        } else {
          console.log('      ℹ️  User was already unregistered.');
          skippedCount++;
        }
        
        // Clear Redis cache for this user
        try {
          await invalidateCachedRegistrationStatus(user._id.toString(), agent.phone || cleanPhone, 'cloudtelephony');
          console.log('      ✅ Redis cache cleared');
        } catch (error) {
          console.warn('      ⚠️  Error clearing Redis cache:', error.message);
          // Non-critical - continue
        }
      } else {
        console.log('   ℹ️  No CloudTelephony registration found - skipping');
        skippedCount++;
      }
      
      console.log('');
    }
    
    console.log('📊 Summary:');
    console.log(`   Total users found: ${users.length}`);
    console.log(`   Successfully reset: ${resetCount}`);
    console.log(`   Skipped (no agent/already unregistered): ${skippedCount}`);
    console.log('');
    console.log('📝 Next time these users start a CATI interview,');
    console.log('   the system will detect registered=false and re-register them.');
    
    return true;
  } catch (error) {
    console.error('❌ Error resetting registration:', error.message);
    throw error;
  }
};

const main = async () => {
  const phoneNumber = process.argv[2];
  
  if (!phoneNumber) {
    console.error('❌ Error: Phone number is required');
    console.log('Usage: node scripts/resetCloudTelephonyRegistration.js <phoneNumber>');
    console.log('Example: node scripts/resetCloudTelephonyRegistration.js 9958011332');
    process.exit(1);
  }
  
  try {
    await connectDB();
    const success = await resetRegistration(phoneNumber);
    
    if (success) {
      console.log('\n✅ Reset process completed successfully!');
    }
  } catch (error) {
    console.error('\n❌ Reset process failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
};

main();

