const mongoose = require('mongoose');
require('dotenv').config();

const createTestQualityManager = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const User = require('../models/User');
    const Company = require('../models/Company');

    // Find a company
    const company = await Company.findOne();
    if (!company) {
      console.log('❌ No company found');
      process.exit(1);
    }

    console.log(`📋 Using company: ${company.companyName} (${company.companyCode})`);

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [
        { email: 'jyoti@test.com' },
        { phone: '+919876543210' }
      ]
    });

    if (existingUser) {
      console.log('⚠️  User already exists:', existingUser._id);
      console.log('   Email:', existingUser.email);
      console.log('   User Type:', existingUser.userType);
      
      // Update assigned surveys if needed
      if (existingUser.userType === 'quality_manager') {
        const surveyId = '68fd1915d41841da463f0d46';
        if (!existingUser.assignedSurveys || !existingUser.assignedSurveys.includes(surveyId)) {
          existingUser.assignedSurveys = existingUser.assignedSurveys || [];
          existingUser.assignedSurveys.push(surveyId);
          await existingUser.save();
          console.log('✅ Updated assigned surveys');
        }
      }
      
      await mongoose.disconnect();
      process.exit(0);
    }

    // Create new Quality Manager
    const newUser = new User({
      firstName: 'Jyoti',
      lastName: 'Jyoti',
      email: 'jyoti@test.com',
      phone: '+919876543210',
      password: 'Test@1234',
      userType: 'quality_manager',
      company: company._id,
      companyCode: company.companyCode,
      status: 'active',
      isEmailVerified: true,
      isPhoneVerified: true,
      assignedSurveys: ['68fd1915d41841da463f0d46']
    });

    await newUser.save();
    console.log('✅ Quality Manager created successfully!');
    console.log('   User ID:', newUser._id);
    console.log('   Email:', newUser.email);
    console.log('   Password: Test@1234');
    console.log('   Assigned Survey: 68fd1915d41841da463f0d46');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

createTestQualityManager();

