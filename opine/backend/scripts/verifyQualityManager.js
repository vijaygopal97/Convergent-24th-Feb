const mongoose = require('mongoose');
require('dotenv').config();

const verifyQualityManager = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const User = require('../models/User');
    const Company = require('../models/Company');

    const user = await User.findOne({ email: 'jyoti@test.com' });
    if (!user) {
      console.log('❌ User not found');
      process.exit(1);
    }

    const company = await Company.findById(user.company);
    
    console.log('\n📋 Quality Manager Details:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Name:', user.firstName, user.lastName);
    console.log('Email:', user.email);
    console.log('User Type:', user.userType);
    console.log('Company:', company?.companyName || 'N/A');
    console.log('Company Code:', user.companyCode);
    console.log('Company Status:', company?.status || 'N/A');
    console.log('User Status:', user.status);
    console.log('Assigned Surveys:', user.assignedSurveys?.length || 0);
    if (user.assignedSurveys && user.assignedSurveys.length > 0) {
      console.log('   Survey IDs:', user.assignedSurveys.join(', '));
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (user.companyCode === 'TEST001' && company?.status === 'active') {
      console.log('✅ Quality Manager is correctly assigned to TEST001 company');
    } else {
      console.log('⚠️  Warning: Company assignment may need adjustment');
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

verifyQualityManager();

