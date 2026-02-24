const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Company = require('../models/Company');

async function createStateManager() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find a company (use the first active company or create one)
    let company = await Company.findOne({ status: 'active' });
    
    if (!company) {
      console.log('⚠️  No active company found. Please create a company first.');
      await mongoose.disconnect();
      return;
    }

    console.log(`📋 Using company: ${company.companyName} (${company.companyCode})`);

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [
        { email: 'bipulsaha@test.com' },
        { phone: '8637516855' }
      ]
    });

    if (existingUser) {
      console.log('⚠️  User already exists with this email or phone');
      console.log(`   User ID: ${existingUser._id}`);
      console.log(`   User Type: ${existingUser.userType}`);
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Phone: ${existingUser.phone}`);
      
      // Update to state_manager if not already
      if (existingUser.userType !== 'state_manager') {
        existingUser.userType = 'state_manager';
        existingUser.stateManagerTypes = ['CAPI', 'CATI'];
        existingUser.company = company._id;
        existingUser.companyCode = company.companyCode;
        await existingUser.save();
        console.log('✅ Updated user to state_manager with CAPI + CATI');
      } else {
        console.log('✅ User is already a state_manager');
      }
      
      await mongoose.disconnect();
      return;
    }

    // Create state manager
    const stateManager = await User.create({
      firstName: 'Bipul',
      lastName: 'Saha',
      email: 'bipulsaha@test.com',
      phone: '8637516855',
      password: '8637516855', // Password same as phone
      userType: 'state_manager',
      company: company._id,
      companyCode: company.companyCode,
      stateManagerTypes: ['CAPI', 'CATI'], // CAPI + CATI
      status: 'active',
      isActive: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      registrationSource: 'company_admin'
    });

    console.log('✅ State Manager created successfully!');
    console.log('📋 Account Details:');
    console.log(`   Name: ${stateManager.firstName} ${stateManager.lastName}`);
    console.log(`   Email: ${stateManager.email}`);
    console.log(`   Phone: ${stateManager.phone}`);
    console.log(`   Password: ${stateManager.phone} (same as phone)`);
    console.log(`   User Type: ${stateManager.userType}`);
    console.log(`   State Manager Types: ${stateManager.stateManagerTypes.join(', ')}`);
    console.log(`   Company: ${company.companyName} (${company.companyCode})`);
    console.log(`   User ID: ${stateManager._id}`);

    await mongoose.disconnect();
    console.log('✅ MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error creating state manager:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

createStateManager();


