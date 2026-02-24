#!/usr/bin/env node

/**
 * Add CATI Interviewer CATI8333 (Dewanjan Das)
 * 
 * This script creates a new CATI interviewer and assigns them to the default survey
 * WITHOUT any AC assignment, following the same pattern as the team-management page.
 * 
 * Requirements:
 * - MemberID: CATI8333
 * - Name: Dewanjan Das
 * - Phone: 9163947344 (keep 91 prefix - it's part of the number, not country code)
 * - Password: 9163947344 (with 91 prefix)
 * - Assign to default survey WITHOUT AC assignment
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const User = require('../models/User');
const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Constants
const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';
const COMPANY_CODE = 'TEST001';
const DEFAULT_COMPANY_ID = '68d33a0cd5e4634e58c4e678';

// User details
const USER_DATA = {
  memberId: '8333', // Numeric member ID (not CATI8333)
  firstName: 'Dewanjan',
  lastName: 'Das',
  phone: '9163947344', // Keep 91 prefix as it's part of the number
  password: '9163947344', // Password with 91 prefix
  email: 'cati8333n@gmail.com' // Different email to avoid conflict with CATI8333
};

/**
 * Find reference user for default values
 */
async function findReferenceUser() {
  try {
    const referenceUser = await User.findOne({
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      status: 'active',
      'interviewerProfile.approvalStatus': 'approved'
    })
    .limit(1)
    .lean();

    return referenceUser;
  } catch (error) {
    console.error('❌ Error finding reference user:', error);
    return null;
  }
}

/**
 * Create CATI interviewer user
 */
async function createCATIInterviewer(referenceUser, assignedBy) {
  try {
    console.log('📝 Creating CATI interviewer...');
    console.log(`   Member ID: ${USER_DATA.memberId}`);
    console.log(`   Name: ${USER_DATA.firstName} ${USER_DATA.lastName}`);
    console.log(`   Phone: ${USER_DATA.phone}`);
    console.log(`   Email: ${USER_DATA.email}\n`);

    // Check if user with this memberId already exists (only check memberId, not phone)
    const existingUser = await User.findOne({
      memberId: USER_DATA.memberId
    });

    if (existingUser) {
      console.log(`⚠️  User with member ID ${USER_DATA.memberId} already exists:`);
      console.log(`   Member ID: ${existingUser.memberId}`);
      console.log(`   Email: ${existingUser.email}`);
      console.log(`   Phone: ${existingUser.phone}`);
      console.log(`   User ID: ${existingUser._id}\n`);
      return { success: false, error: 'User already exists', user: existingUser };
    }
    
    // Check if email is taken (use different email if needed)
    const existingEmail = await User.findOne({ email: USER_DATA.email.toLowerCase() });
    if (existingEmail) {
      console.log(`⚠️  Email ${USER_DATA.email} is already taken. Using alternative email...`);
      USER_DATA.email = `cati${USER_DATA.memberId}@gmail.com`;
      console.log(`   New email: ${USER_DATA.email}\n`);
    }
    
    // Note: Phone number might be shared with other users (like CATI8333), which is allowed

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(USER_DATA.password, salt);

    // Get company ID from reference user or default
    const companyId = referenceUser?.company || new mongoose.Types.ObjectId(DEFAULT_COMPANY_ID);

    // Create user object
    const newUser = new User({
      firstName: USER_DATA.firstName,
      lastName: USER_DATA.lastName,
      email: USER_DATA.email.toLowerCase(),
      phone: USER_DATA.phone, // Store with 91 prefix
      password: hashedPassword,
      isEmailVerified: referenceUser?.isEmailVerified || false,
      isPhoneVerified: referenceUser?.isPhoneVerified || false,
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      canSelectMode: referenceUser?.canSelectMode || false,
      company: companyId,
      companyCode: COMPANY_CODE,
      memberId: USER_DATA.memberId,
      profile: referenceUser?.profile || {
        languages: [],
        education: [],
        experience: []
      },
      documents: referenceUser?.documents || {
        aadhaar: { isVerified: false },
        pan: { isVerified: false },
        drivingLicense: { isVerified: false },
        bankDetails: { isVerified: false }
      },
      status: 'active',
      isActive: true,
      gig_availability: referenceUser?.gig_availability || false,
      gig_enabled: referenceUser?.gig_enabled || false,
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
      preferences: referenceUser?.preferences || {
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
      training: referenceUser?.training || {
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
        bankAccountHolderName: `${USER_DATA.firstName.toUpperCase()} ${USER_DATA.lastName.toUpperCase()}`,
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
        approvalStatus: 'approved',
        approvalFeedback: 'Approved for CATI',
        approvedBy: assignedBy || referenceUser?.interviewerProfile?.approvedBy || new mongoose.Types.ObjectId(DEFAULT_COMPANY_ID),
        approvedAt: new Date(),
        lastSubmittedAt: new Date()
      },
      loginAttempts: 0,
      assignedTeamMembers: [],
      registrationSource: 'company_admin'
    });

    // Save user
    await newUser.save({ runValidators: false });
    console.log(`✅ User created successfully`);
    console.log(`   User ID: ${newUser._id}\n`);

    // Verify password
    const savedUser = await User.findById(newUser._id).select('+password');
    const passwordValid = await savedUser.comparePassword(USER_DATA.password);
    
    if (!passwordValid) {
      console.log(`⚠️  Password verification failed, retrying...`);
      const retrySalt = await bcrypt.genSalt(12);
      const retryHashedPassword = await bcrypt.hash(USER_DATA.password, retrySalt);
      await User.updateOne(
        { _id: savedUser._id },
        { $set: { password: retryHashedPassword } }
      );
      
      const retryUser = await User.findById(savedUser._id).select('+password');
      const retryValid = await retryUser.comparePassword(USER_DATA.password);
      if (!retryValid) {
        await User.deleteOne({ _id: newUser._id });
        throw new Error('Failed to set password correctly');
      }
    }

    console.log(`✅ Password verified successfully\n`);

    return { success: true, user: savedUser };
  } catch (error) {
    console.error('❌ Error creating user:', error);
    throw error;
  }
}

/**
 * Assign interviewer to default survey WITHOUT AC assignment
 */
async function assignToSurvey(interviewerId, assignedById) {
  try {
    console.log('📋 Assigning interviewer to default survey...');
    console.log(`   Survey ID: ${DEFAULT_SURVEY_ID}\n`);

    const survey = await Survey.findById(DEFAULT_SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${DEFAULT_SURVEY_ID} not found`);
    }

    console.log(`✅ Found survey: ${survey.surveyName}\n`);

    // Check if interviewer is already assigned
    const existingAssignment = survey.catiInterviewers?.find(
      assignment => assignment.interviewer.toString() === interviewerId.toString()
    );

    if (existingAssignment) {
      console.log(`⚠️  Interviewer already assigned to this survey`);
      console.log(`   Status: ${existingAssignment.status}`);
      console.log(`   Assigned ACs: ${existingAssignment.assignedACs?.length || 0}`);
      if (existingAssignment.assignedACs && existingAssignment.assignedACs.length > 0) {
        console.log(`   ACs: ${existingAssignment.assignedACs.join(', ')}`);
      }
      console.log(`   Assigned at: ${existingAssignment.assignedAt}\n`);
      return { success: true, alreadyAssigned: true };
    }

    // Initialize catiInterviewers array if it doesn't exist
    if (!survey.catiInterviewers) {
      survey.catiInterviewers = [];
    }

    // Add to catiInterviewers array WITHOUT AC assignment
    survey.catiInterviewers.push({
      interviewer: interviewerId,
      assignedBy: assignedById,
      assignedAt: new Date(),
      assignedACs: [], // Empty array - no AC assignment
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    });

    await survey.save();

    console.log(`✅ Interviewer assigned to survey successfully!`);
    console.log(`   Status: assigned`);
    console.log(`   Assigned ACs: 0 (no AC assignment)\n`);

    return { success: true, alreadyAssigned: false };
  } catch (error) {
    console.error('❌ Error assigning to survey:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('='.repeat(70));
    console.log('ADD CATI INTERVIEWER - 8333');
    console.log('='.repeat(70));
    console.log(`Member ID: ${USER_DATA.memberId} (numeric, not CATI8333)`);
    console.log(`Name: ${USER_DATA.firstName} ${USER_DATA.lastName}`);
    console.log(`Phone: ${USER_DATA.phone} (with 91 prefix)`);
    console.log(`Password: ${USER_DATA.password} (with 91 prefix)`);
    console.log(`Email: ${USER_DATA.email}`);
    console.log('='.repeat(70) + '\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI not found in environment variables');
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Find reference user
    console.log('🔍 Finding reference user for default values...');
    const referenceUser = await findReferenceUser();
    if (referenceUser) {
      console.log(`✅ Found reference user: ${referenceUser.memberId || referenceUser._id}\n`);
    } else {
      console.log(`⚠️  No reference user found, using defaults\n`);
    }

    // Get assignedBy (use reference user's approvedBy or default company admin)
    const assignedBy = referenceUser?.interviewerProfile?.approvedBy || new mongoose.Types.ObjectId(DEFAULT_COMPANY_ID);

    // Create interviewer
    const createResult = await createCATIInterviewer(referenceUser, assignedBy);
    
    let userId;
    if (!createResult.success) {
      // If user already exists, don't update - just report and exit
      throw new Error(`User with member ID ${USER_DATA.memberId} or phone ${USER_DATA.phone} already exists. Cannot create duplicate.`);
    } else {
      userId = createResult.user._id;
    }

    // Assign to survey
    const assignResult = await assignToSurvey(userId, assignedBy);

    // Verify final state
    console.log('🔍 Verifying final state...\n');
    const finalUser = await User.findOne({
      memberId: USER_DATA.memberId
    }).lean();
    
    if (!finalUser) {
      throw new Error('User not found for verification');
    }
    
    const finalSurvey = await Survey.findById(DEFAULT_SURVEY_ID).lean();
    if (!finalSurvey) {
      throw new Error('Survey not found for verification');
    }
    
    const finalAssignment = finalSurvey.catiInterviewers?.find(
      a => a.interviewer.toString() === finalUser._id.toString()
    );

    console.log('='.repeat(70));
    console.log('FINAL VERIFICATION');
    console.log('='.repeat(70));
    console.log(`✅ User created:`);
    console.log(`   Member ID: ${finalUser.memberId}`);
    console.log(`   Name: ${finalUser.firstName} ${finalUser.lastName}`);
    console.log(`   Email: ${finalUser.email}`);
    console.log(`   Phone: ${finalUser.phone}`);
    console.log(`   Status: ${finalUser.status}`);
    console.log(`   Approval Status: ${finalUser.interviewerProfile?.approvalStatus || 'N/A'}`);
    console.log(`\n✅ Survey assignment:`);
    console.log(`   Survey: ${finalSurvey.surveyName}`);
    console.log(`   Status: ${finalAssignment?.status || 'N/A'}`);
    console.log(`   Assigned ACs: ${finalAssignment?.assignedACs?.length || 0}`);
    if (finalAssignment?.assignedACs && finalAssignment.assignedACs.length > 0) {
      console.log(`   ACs: ${finalAssignment.assignedACs.join(', ')}`);
    } else {
      console.log(`   ACs: None (as requested)`);
    }
    console.log('='.repeat(70));

    await mongoose.connection.close();
    console.log('\n✅ Done');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main, createCATIInterviewer, assignToSurvey };

