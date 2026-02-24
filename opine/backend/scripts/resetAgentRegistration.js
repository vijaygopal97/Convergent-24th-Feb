/**
 * Reset CloudTelephony Agent Registration Status
 * 
 * This script resets the registration status for an agent so they can be re-registered.
 * It clears both Redis cache and MongoDB database records.
 * 
 * Usage: node scripts/resetAgentRegistration.js <phoneNumber>
 * Example: node scripts/resetAgentRegistration.js 9958011332
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CatiAgent = require('../models/CatiAgent');
const User = require('../models/User');
const { invalidateCachedRegistrationStatus } = require('../utils/catiAgentCache');

async function resetAgentRegistration(phoneNumber) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clean phone number
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    console.log(`\n📞 Resetting registration for phone: ${cleanPhone}`);

    // Find user by phone number
    const user = await User.findOne({
      phone: { $regex: cleanPhone }
    }).lean();

    if (!user) {
      console.log(`❌ User not found with phone: ${cleanPhone}`);
      console.log('   Please check the phone number and try again.');
      process.exit(1);
    }

    console.log(`✅ Found user: ${user._id} (${user.firstName || ''} ${user.lastName || ''})`);

    // Find or create CatiAgent record
    let agent = await CatiAgent.findOne({ user: user._id, phone: cleanPhone });

    if (!agent) {
      console.log('⚠️  No CatiAgent record found, creating new one...');
      agent = new CatiAgent({
        user: user._id,
        phone: cleanPhone
      });
    } else {
      console.log(`✅ Found CatiAgent record: ${agent._id}`);
      const currentStatus = agent.providers?.cloudtelephony?.registered;
      console.log(`   Current registration status: ${currentStatus ? 'REGISTERED' : 'NOT REGISTERED'}`);
    }

    // Reset CloudTelephony registration status
    if (!agent.providers) {
      agent.providers = {};
    }
    if (!agent.providers.cloudtelephony) {
      agent.providers.cloudtelephony = {};
    }

    agent.providers.cloudtelephony.registered = false;
    agent.providers.cloudtelephony.registeredAt = null;
    agent.providers.cloudtelephony.agentId = null;
    agent.providers.cloudtelephony.lastChecked = new Date();

    agent.markModified('providers');
    await agent.save();

    console.log(`✅ Updated MongoDB: Set registration status to FALSE`);

    // Clear Redis cache
    console.log(`\n🗑️  Clearing Redis cache...`);
    await invalidateCachedRegistrationStatus(user._id.toString(), cleanPhone, 'cloudtelephony');
    console.log(`✅ Cleared Redis cache for: cati:agent:registered:${user._id}:${cleanPhone}:cloudtelephony`);

    console.log(`\n✅ Successfully reset agent registration status!`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. The agent will be automatically re-registered on the next call attempt`);
    console.log(`   2. Or you can manually trigger registration by making a test call`);
    console.log(`\n✅ Done!`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting agent registration:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Get phone number from command line
const phoneNumber = process.argv[2];

if (!phoneNumber) {
  console.error('❌ Error: Phone number is required');
  console.log('\nUsage: node scripts/resetAgentRegistration.js <phoneNumber>');
  console.log('Example: node scripts/resetAgentRegistration.js 9958011332');
  process.exit(1);
}

resetAgentRegistration(phoneNumber);

