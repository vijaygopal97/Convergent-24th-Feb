#!/usr/bin/env node

/**
 * Add Single CATI Interviewer with Specific Member ID
 * 
 * This script adds a single CATI interviewer with a pre-specified member ID and AC assignment.
 * Phone numbers are kept as-is (91 prefix is NOT removed if present).
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const Survey = require('../models/Survey');
const Company = require('../models/Company');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');

/**
 * Load AC names from JSON
 */
function loadACNames() {
  const data = JSON.parse(fs.readFileSync(AC_JSON_PATH, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  return acMap;
}

/**
 * Normalize phone number - KEEP 91 prefix as user requested
 */
function normalizePhone(phone) {
  if (!phone) return null;
  // Remove spaces and +, but keep 91 prefix
  let normalized = phone.replace(/\s+/g, '').replace(/^\+/, '').trim();
  
  // Ensure it's a valid length (should be 10 digits with 91 prefix = 10 digits total)
  if (normalized.length !== 10) {
    throw new Error(`Invalid phone number: ${phone} (normalized to ${normalized}, length: ${normalized.length}, expected 10)`);
  }
  
  return normalized;
}

/**
 * Create CATI interviewer user
 */
async function createCATIInterviewer(interviewerData, companyId, companyCode) {
  const { memberId, firstName, lastName, phone } = interviewerData;
  const normalizedPhone = normalizePhone(phone);
  const password = normalizedPhone; // Password is phone number
  
  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [
      { phone: normalizedPhone },
      { memberId: String(memberId) },
      { email: `cati${memberId}@gmail.com` }
    ]
  });
  
  if (existingUser) {
    throw new Error(`User already exists: ${existingUser.memberId} (${existingUser.phone})`);
  }
  
  // Get reference user for default values
  const referenceUser = await User.findOne({
    userType: 'interviewer',
    company: companyId,
    interviewModes: 'CATI (Telephonic interview)'
  }).limit(1).lean();
  
  // Create user data (similar to addInterviewerByProjectManager)
  const userData = {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: `cati${memberId}@gmail.com`,
    phone: normalizedPhone,
    password: password, // Will be hashed by pre-save hook
    userType: 'interviewer',
    interviewModes: 'CATI (Telephonic interview)',
    canSelectMode: false,
    company: companyId,
    companyCode: companyCode,
    memberId: String(memberId),
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
      bankAccountHolderName: `${firstName.toUpperCase()} ${lastName.toUpperCase()}`,
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
      approvedBy: null,
      approvedAt: new Date(),
      lastSubmittedAt: new Date()
    },
    loginAttempts: 0,
    assignedTeamMembers: []
  };
  
  // Create the interviewer
  const newInterviewer = await User.create(userData);
  
  // Verify password was hashed correctly
  const savedUser = await User.findById(newInterviewer._id).select('+password');
  const passwordValid = await savedUser.comparePassword(password);
  
  if (!passwordValid) {
    console.log(`⚠️  Password verification failed, retrying...`);
    // Re-hash and update directly
    const retrySalt = await bcrypt.genSalt(12);
    const retryHashedPassword = await bcrypt.hash(password, retrySalt);
    await User.updateOne(
      { _id: savedUser._id },
      { $set: { password: retryHashedPassword } }
    );
    
    // Verify again
    const retryUser = await User.findById(savedUser._id).select('+password');
    const retryValid = await retryUser.comparePassword(password);
    if (!retryValid) {
      await User.deleteOne({ _id: newInterviewer._id });
      throw new Error('Failed to set password correctly');
    }
  }
  
  return newInterviewer;
}

/**
 * Assign interviewer to survey as CATI interviewer
 */
async function assignToSurvey(surveyId, interviewerId, assignedBy = null) {
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }
  
  // Check if already assigned
  const existing = survey.catiInterviewers.find(
    assignment => assignment.interviewer.toString() === interviewerId.toString()
  );
  
  if (existing) {
    return { alreadyAssigned: true, assignment: existing };
  }
  
  // Add assignment
  survey.catiInterviewers.push({
    interviewer: interviewerId,
    assignedBy: assignedBy || interviewerId,
    assignedAt: new Date(),
    status: 'assigned',
    assignedACs: [],
    maxInterviews: 0,
    completedInterviews: 0
  });
  
  await survey.save();
  return { alreadyAssigned: false };
}

/**
 * Assign AC to interviewer
 */
async function assignACToInterviewer(surveyId, interviewerId, acCode, acName) {
  const survey = await Survey.findById(surveyId);
  if (!survey) {
    throw new Error(`Survey ${surveyId} not found`);
  }
  
  if (!survey.catiInterviewers) {
    throw new Error('Survey does not have catiInterviewers array');
  }
  
  const assignment = survey.catiInterviewers.find(
    a => a.interviewer.toString() === interviewerId.toString()
  );
  
  if (!assignment) {
    throw new Error('Interviewer not assigned to survey');
  }
  
  // Clear existing ACs
  if (assignment.assignedACs && assignment.assignedACs.length > 0) {
    assignment.assignedACs = [];
  }
  
  // Add new AC
  assignment.assignedACs.push(acName);
  survey.markModified('catiInterviewers');
  await survey.save();
  
  return { success: true };
}

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.length < 4) {
      console.error('❌ Error: Missing required arguments');
      console.error('\nUsage: node add_single_cati_interviewer.js <memberId> <firstName> <lastName> <phone> <acCode>');
      console.error('\nExample:');
      console.error('  node add_single_cati_interviewer.js 8356 Sukhendu Das 9134783447 WB145');
      process.exit(1);
    }
    
    const memberId = args[0];
    const firstName = args[1];
    const lastName = args[2];
    const phone = args[3];
    const acCode = args[4] || 'WB145'; // Default to Satgachhia
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('ADD SINGLE CATI INTERVIEWER');
    console.log('='.repeat(80));
    console.log(`Member ID: ${memberId}`);
    console.log(`Name: ${firstName} ${lastName}`);
    console.log(`Phone: ${phone} (keeping 91 prefix as-is)`);
    console.log(`AC to assign: ${acCode}`);
    console.log(`Survey ID: ${SURVEY_ID}\n`);
    
    // Load AC names
    console.log('📖 Loading AC names...');
    const acNameMap = loadACNames();
    const acName = acNameMap[acCode];
    
    if (!acName) {
      throw new Error(`AC name not found for code: ${acCode}`);
    }
    
    console.log(`✅ Found AC: ${acCode} (${acName})\n`);
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Survey found: ${survey.surveyName}`);
    
    // Get company from survey
    const company = await Company.findById(survey.company).lean();
    if (!company) {
      throw new Error('Survey company not found');
    }
    console.log(`✅ Company: ${company.companyName} (${company.companyCode})\n`);
    
    // Create interviewer
    console.log(`📝 Creating interviewer...`);
    const interviewerData = {
      memberId,
      firstName,
      lastName,
      phone
    };
    
    const newInterviewer = await createCATIInterviewer(
      interviewerData,
      company._id,
      company.companyCode
    );
    
    console.log(`✅ Interviewer created: ${newInterviewer.firstName} ${newInterviewer.lastName}`);
    console.log(`   Member ID: ${newInterviewer.memberId}`);
    console.log(`   Email: ${newInterviewer.email}`);
    console.log(`   Phone: ${newInterviewer.phone}`);
    
    // Assign to survey
    console.log(`\n📋 Assigning to survey...`);
    const assignResult = await assignToSurvey(SURVEY_ID, newInterviewer._id);
    if (assignResult.alreadyAssigned) {
      console.log(`⚠️  Already assigned to survey`);
    } else {
      console.log(`✅ Assigned to survey`);
    }
    
    // Assign AC
    console.log(`\n📍 Assigning AC: ${acCode} (${acName})...`);
    await assignACToInterviewer(SURVEY_ID, newInterviewer._id, acCode, acName);
    console.log(`✅ AC assigned successfully`);
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Successfully added interviewer:`);
    console.log(`   Name: ${newInterviewer.firstName} ${newInterviewer.lastName}`);
    console.log(`   Member ID: ${newInterviewer.memberId}`);
    console.log(`   Phone: ${newInterviewer.phone}`);
    console.log(`   Email: ${newInterviewer.email}`);
    console.log(`   Password: ${newInterviewer.phone} (same as phone)`);
    console.log(`   AC: ${acCode} (${acName})`);
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();




















