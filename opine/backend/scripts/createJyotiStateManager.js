const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Company = require('../models/Company');

async function createJyotiStateManager() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find the same company as bipulsaha@gmail.com
    const bipul = await User.findOne({ email: 'bipulsaha@gmail.com' }).lean();
    if (!bipul) {
      console.log('⚠️  bipulsaha@gmail.com not found. Using first active company.');
      const company = await Company.findOne({ status: 'active' }).sort({ createdAt: 1 });
      if (!company) {
        console.log('⚠️  No active company found. Please create a company first.');
        await mongoose.disconnect();
        return;
      }
      var companyToUse = company;
    } else {
      var companyToUse = await Company.findById(bipul.company).lean();
      if (!companyToUse) {
        console.log('⚠️  Company not found for bipulsaha. Using first active company.');
        const company = await Company.findOne({ status: 'active' }).sort({ createdAt: 1 });
        if (!company) {
          console.log('⚠️  No active company found. Please create a company first.');
          await mongoose.disconnect();
          return;
        }
        companyToUse = company;
      }
    }

    console.log(`📋 Using company: ${companyToUse.companyName} (${companyToUse.companyCode})`);

    // New state manager details
    const newStateManagerEmail = 'jyoti.convergent@gmail.com';
    const newStateManagerPhone = '9876543213';
    const newStateManagerFirstName = 'Jyoti';
    const newStateManagerLastName = 'Convergent';
    const newStateManagerPassword = 'Convergent@SM#1';

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [
        { email: newStateManagerEmail },
        { phone: newStateManagerPhone }
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
        existingUser.company = companyToUse._id;
        existingUser.companyCode = companyToUse.companyCode;
        await existingUser.save();
        console.log('✅ Updated user to state_manager with CAPI + CATI');
      } else {
        console.log('✅ User is already a state_manager');
        if (JSON.stringify(existingUser.stateManagerTypes.sort()) !== JSON.stringify(['CAPI', 'CATI'].sort())) {
          existingUser.stateManagerTypes = ['CAPI', 'CATI'];
          await existingUser.save();
          console.log('✅ Updated stateManagerTypes to CAPI + CATI');
        }
      }
      
      // Update password if needed
      if (existingUser.password !== newStateManagerPassword) {
        existingUser.password = newStateManagerPassword;
        await existingUser.save();
        console.log('✅ Updated password');
      }
      
      await mongoose.disconnect();
      return;
    }

    // Create state manager
    const stateManager = await User.create({
      firstName: newStateManagerFirstName,
      lastName: newStateManagerLastName,
      email: newStateManagerEmail,
      phone: newStateManagerPhone,
      password: newStateManagerPassword,
      userType: 'state_manager',
      company: companyToUse._id,
      companyCode: companyToUse.companyCode,
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
    console.log(`   Password: ${newStateManagerPassword}`);
    console.log(`   User Type: ${stateManager.userType}`);
    console.log(`   State Manager Types: ${stateManager.stateManagerTypes.join(', ')}`);
    console.log(`   Company: ${companyToUse.companyName} (${companyToUse.companyCode})`);
    console.log(`   User ID: ${stateManager._id}`);

    await mongoose.disconnect();
    console.log('✅ MongoDB connection closed');
  } catch (error) {
    console.error('❌ Error creating state manager:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

createJyotiStateManager();










































