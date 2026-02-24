#!/usr/bin/env node

/**
 * Script to add an approved CATI interviewer to a survey
 * This bypasses the phone normalization that removes "91" prefix
 * 
 * Usage: node scripts/addApprovedCatiInterviewer.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Survey = require('../models/Survey');
const Company = require('../models/Company');
const CatiAgent = require('../models/CatiAgent');

// Configuration
const CONFIG = {
  memberId: '5140',
  firstName: 'Banani',
  lastName: 'Bhowmick Jana',
  phone: '9163922836', // Keep as is, don't remove "91"
  password: '9163922836', // Same as phone number
  surveyId: '68fd1915d41841da463f0d46',
  interviewerType: 'CATI'
};

async function addApprovedCatiInterviewer() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find survey
    const survey = await Survey.findById(CONFIG.surveyId);
    if (!survey) {
      throw new Error(`Survey ${CONFIG.surveyId} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName || survey._id}`);

    // Get company from survey
    const company = await Company.findById(survey.company);
    if (!company) {
      throw new Error(`Company not found for survey`);
    }
    console.log(`✅ Found company: ${company.companyName || company._id}`);

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { memberId: CONFIG.memberId },
        { phone: CONFIG.phone },
        { email: `cati${CONFIG.memberId}@gmail.com` }
      ]
    });

    if (existingUser) {
      console.log(`⚠️  User already exists with memberId: ${CONFIG.memberId}`);
      console.log(`   User ID: ${existingUser._id}`);
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Phone: ${existingUser.phone}`);
      
      // Check if already assigned to survey
      const alreadyAssigned = survey.catiInterviewers?.some(
        ci => ci.interviewer.toString() === existingUser._id.toString()
      );
      
      if (alreadyAssigned) {
        console.log(`✅ User is already assigned to survey ${CONFIG.surveyId}`);
        return;
      }
      
      // Assign to survey
      if (!survey.catiInterviewers) {
        survey.catiInterviewers = [];
      }
      
      survey.catiInterviewers.push({
        interviewer: existingUser._id,
        assignedAt: new Date(),
        assignedBy: existingUser._id, // Use user's own ID as assignedBy
        status: 'assigned',
        maxInterviews: 0,
        completedInterviews: 0
      });
      
      await survey.save();
      console.log(`✅ Assigned existing user to survey`);
      return;
    }

    // Get reference user for default values
    const referenceUser = await User.findOne({
      userType: 'interviewer',
      company: company._id,
      interviewModes: 'CATI (Telephonic interview)'
    }).limit(1);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(CONFIG.password, salt);

    // Create user data
    const userData = {
      firstName: CONFIG.firstName.trim(),
      lastName: CONFIG.lastName.trim(),
      email: `cati${CONFIG.memberId}@gmail.com`.toLowerCase(),
      phone: CONFIG.phone, // Keep phone as is, don't normalize
      password: hashedPassword,
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      canSelectMode: false,
      company: company._id,
      companyCode: company.companyCode,
      memberId: CONFIG.memberId,
      status: 'active',
      isActive: true,
      isEmailVerified: false,
      isPhoneVerified: false,
      gig_enabled: false,
      gig_availability: false,
      registrationSource: 'company_admin',
      profile: referenceUser?.profile || { languages: [], education: [], experience: [] },
      documents: referenceUser?.documents || {
        aadhaar: { isVerified: false },
        pan: { isVerified: false },
        drivingLicense: { isVerified: false },
        bankDetails: { isVerified: false }
      },
      performance: referenceUser?.performance || {
        trustScore: 100,
        totalInterviews: 0,
        approvedInterviews: 0,
        rejectedInterviews: 0,
        averageRating: 0,
        totalEarnings: 0,
        qualityMetrics: {
          audioQuality: 0,
          responseAccuracy: 0,
          timeliness: 0,
          professionalism: 0
        }
      },
      preferences: {
        notifications: {
          email: true,
          sms: true,
          push: true,
          surveyAssignments: true,
          paymentUpdates: true,
          qualityFeedback: true
        },
        workingHours: {
          startTime: '09:00',
          endTime: '18:00',
          workingDays: [],
          timezone: 'Asia/Kolkata'
        },
        surveyPreferences: {
          maxDistance: 50,
          preferredLocations: [],
          minPayment: 0,
          maxInterviewsPerDay: 10
        },
        locationControlBooster: false
      },
      training: {
        completedModules: [],
        certificationStatus: 'not_started'
      },
      interviewerProfile: {
        age: referenceUser?.interviewerProfile?.age || 28,
        gender: referenceUser?.interviewerProfile?.gender || 'male',
        languagesSpoken: referenceUser?.interviewerProfile?.languagesSpoken || ['Hindi', 'English'],
        highestDegree: referenceUser?.interviewerProfile?.highestDegree || {
          name: 'B.Tech',
          institution: 'NIT',
          year: 2019
        },
        hasSurveyExperience: true,
        surveyExperienceYears: 3,
        surveyExperienceDescription: 'Experienced in telephonic surveys',
        cvUpload: referenceUser?.interviewerProfile?.cvUpload || 'cvUpload-1764630127133-571761495.docx',
        ownsSmartphone: true,
        smartphoneType: 'Both',
        androidVersion: '13',
        iosVersion: '',
        willingToTravel: true,
        hasVehicle: true,
        willingToRecordAudio: true,
        agreesToRemuneration: true,
        bankAccountNumber: referenceUser?.interviewerProfile?.bankAccountNumber || '786897980',
        bankAccountHolderName: `${CONFIG.firstName.toUpperCase()} ${CONFIG.lastName.toUpperCase()}`,
        bankName: referenceUser?.interviewerProfile?.bankName || 'HDFC',
        bankIfscCode: referenceUser?.interviewerProfile?.bankIfscCode || 'HDFC0001234',
        bankDocumentUpload: referenceUser?.interviewerProfile?.bankDocumentUpload || 'bankDocumentUpload-1764630178675-881719772.png',
        aadhaarNumber: referenceUser?.interviewerProfile?.aadhaarNumber || '876897697890',
        aadhaarDocument: referenceUser?.interviewerProfile?.aadhaarDocument || 'aadhaarDocument-1764630188489-204099240.png',
        panNumber: referenceUser?.interviewerProfile?.panNumber || '7868979879',
        panDocument: referenceUser?.interviewerProfile?.panDocument || 'panDocument-1764630192433-387051607.png',
        passportPhoto: referenceUser?.interviewerProfile?.passportPhoto || 'passportPhoto-1764630195659-468808359.png',
        agreesToShareInfo: true,
        agreesToParticipateInSurvey: true,
        approvalStatus: 'approved', // Set as approved
        approvalFeedback: 'Approved for CATI',
        approvedBy: company._id, // Use company ID as approvedBy
        approvedAt: new Date(),
        lastSubmittedAt: new Date()
      },
      loginAttempts: 0,
      assignedTeamMembers: []
    };

    // Create the interviewer
    console.log(`\n📝 Creating interviewer...`);
    const newInterviewer = await User.create(userData);
    console.log(`✅ Created interviewer: ${newInterviewer._id}`);
    console.log(`   Name: ${newInterviewer.firstName} ${newInterviewer.lastName}`);
    console.log(`   Email: ${newInterviewer.email}`);
    console.log(`   Phone: ${newInterviewer.phone}`);
    console.log(`   Member ID: ${newInterviewer.memberId}`);
    console.log(`   Approval Status: ${newInterviewer.interviewerProfile?.approvalStatus}`);

    // Verify password
    const savedUser = await User.findById(newInterviewer._id).select('+password');
    const passwordValid = await savedUser.comparePassword(CONFIG.password);
    
    if (!passwordValid) {
      console.log(`⚠️  Password verification failed, retrying...`);
      const retrySalt = await bcrypt.genSalt(12);
      const retryHashedPassword = await bcrypt.hash(CONFIG.password, retrySalt);
      await User.updateOne(
        { _id: savedUser._id },
        { $set: { password: retryHashedPassword } }
      );
      console.log(`✅ Password updated`);
    } else {
      console.log(`✅ Password verified`);
    }

    // Assign to survey
    console.log(`\n📝 Assigning to survey...`);
    if (!survey.catiInterviewers) {
      survey.catiInterviewers = [];
    }
    
    // Check if already assigned
    const alreadyAssigned = survey.catiInterviewers.some(
      ci => ci.interviewer.toString() === newInterviewer._id.toString()
    );
    
    if (alreadyAssigned) {
      console.log(`⚠️  Already assigned to survey`);
    } else {
      survey.catiInterviewers.push({
        interviewer: newInterviewer._id,
        assignedAt: new Date(),
        assignedBy: newInterviewer._id, // Use interviewer's own ID
        status: 'assigned',
        maxInterviews: 0,
        completedInterviews: 0
      });
      
      await survey.save();
      console.log(`✅ Assigned to survey: ${CONFIG.surveyId}`);
    }

    // Create CatiAgent record (for provider registration tracking)
    console.log(`\n📝 Creating CatiAgent record...`);
    const existingAgent = await CatiAgent.findOne({
      user: newInterviewer._id,
      phone: CONFIG.phone
    });

    if (!existingAgent) {
      await CatiAgent.create({
        user: newInterviewer._id,
        phone: CONFIG.phone,
        providers: {
          deepcall: {
            registered: false,
            registeredAt: null,
            lastChecked: null
          },
          cloudtelephony: {
            registered: false,
            registeredAt: null,
            lastChecked: null,
            agentId: null
          }
        }
      });
      console.log(`✅ Created CatiAgent record`);
    } else {
      console.log(`⚠️  CatiAgent record already exists`);
    }

    console.log(`\n✅ Successfully added approved CATI interviewer!`);
    console.log(`\n📊 Summary:`);
    console.log(`   Name: ${CONFIG.firstName} ${CONFIG.lastName}`);
    console.log(`   Member ID: ${CONFIG.memberId}`);
    console.log(`   Phone: ${CONFIG.phone}`);
    console.log(`   Email: ${newInterviewer.email}`);
    console.log(`   Password: ${CONFIG.password}`);
    console.log(`   Survey: ${CONFIG.surveyId}`);
    console.log(`   Approval Status: approved`);

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script
addApprovedCatiInterviewer();


