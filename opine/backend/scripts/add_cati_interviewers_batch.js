#!/usr/bin/env node

/**
 * Add Multiple CATI Interviewers and Assign to Survey
 * 
 * This script adds CATI interviewers and assigns them to a survey with AC assignments.
 * Follows the same process as Project Manager Dashboard.
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
const ACS_TO_ASSIGN = ['WB182', 'WB162', 'WB011', 'WB116', 'WB283'];
const AC_JSON_PATH = path.join(__dirname, '../data/assemblyConstituencies.json');
const STARTING_MEMBER_ID = 320;

// Interviewers to add
const INTERVIEWERS = [
  { firstName: 'Suvankar', lastName: 'Chowdhury', phone: '8967408759' },
  { firstName: 'PARTHA PRATIM', lastName: 'PAUL', phone: '9163258007' }, // 10 digits - keep as-is
  { firstName: 'SAHITYA', lastName: 'MONDAL', phone: '7865894125' }, // Removed space
  { firstName: 'AYAN', lastName: 'MAJUMDAR', phone: '8697700821' },
  { firstName: 'RAJU', lastName: 'GOPE', phone: '8420592263' },
  { firstName: 'PARTHA SARTHI', lastName: 'MAJUMDER', phone: '9830556500' }
];

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
 * Find next available member ID starting from STARTING_MEMBER_ID
 */
async function findNextAvailableMemberId(startFrom) {
  let memberId = startFrom;
  let attempts = 0;
  const maxAttempts = 1000; // Allow up to 1000 attempts
  
  while (attempts < maxAttempts) {
    const existingUser = await User.findOne({ memberId: String(memberId) });
    if (!existingUser) {
      return String(memberId);
    }
    memberId++;
    attempts++;
  }
  
  throw new Error(`Could not find available member ID after ${maxAttempts} attempts`);
}

/**
 * Normalize phone number (remove country code, spaces, etc.)
 */
function normalizePhone(phone) {
  if (!phone) return null;
  // Remove spaces and +
  let normalized = phone.replace(/\s+/g, '').replace(/^\+/, '').trim();
  
  // Handle different phone number formats
  if (normalized.length === 12 && normalized.startsWith('91')) {
    // 12 digits starting with 91: remove country code (91 + 10 digits)
    normalized = normalized.substring(2);
  } else if (normalized.length === 11 && normalized.startsWith('0')) {
    // 11 digits starting with 0: remove leading 0
    normalized = normalized.substring(1);
  } else if (normalized.length === 10 && normalized.startsWith('91')) {
    // 10 digits starting with 91: This is unusual for Indian numbers
    // Indian mobile numbers start with 6-9, not 91
    // However, if user provided it as 10 digits, we'll keep it as-is
    // (might be intentional or a data entry quirk)
    console.warn(`⚠️  Warning: Phone number ${normalized} starts with 91 (unusual for Indian mobile, but keeping as-is)`);
  }
  
  // Ensure 10 digits
  if (normalized.length !== 10) {
    throw new Error(`Invalid phone number: ${phone} (normalized to ${normalized}, length: ${normalized.length})`);
  }
  
  return normalized;
}

/**
 * Create CATI interviewer user
 */
async function createCATIInterviewer(interviewerData, memberId, companyId, companyCode) {
  const { firstName, lastName, phone } = interviewerData;
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
      approvedBy: null, // Will be set if we have a project manager
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
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('ADD CATI INTERVIEWERS BATCH');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`ACs to assign: ${ACS_TO_ASSIGN.join(', ')}`);
    console.log(`Starting Member ID: ${STARTING_MEMBER_ID}`);
    console.log(`Total interviewers to add: ${INTERVIEWERS.length}\n`);
    
    // Load AC names
    console.log('📖 Loading AC names...');
    const acNameMap = loadACNames();
    const acCodeToName = {};
    ACS_TO_ASSIGN.forEach(code => {
      acCodeToName[code] = acNameMap[code];
      if (!acCodeToName[code]) {
        throw new Error(`AC name not found for code: ${code}`);
      }
    });
    console.log('✅ AC names loaded:\n');
    ACS_TO_ASSIGN.forEach(code => {
      console.log(`   ${code}: ${acCodeToName[code]}`);
    });
    console.log('');
    
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
    
    const results = [];
    let currentMemberId = STARTING_MEMBER_ID;
    
    // Process each interviewer
    for (let i = 0; i < INTERVIEWERS.length; i++) {
      const interviewer = INTERVIEWERS[i];
      const acCode = ACS_TO_ASSIGN[i % ACS_TO_ASSIGN.length]; // Round-robin AC assignment
      const acName = acCodeToName[acCode];
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Interviewer ${i + 1}/${INTERVIEWERS.length}`);
      console.log('='.repeat(80));
      console.log(`Name: ${interviewer.firstName} ${interviewer.lastName}`);
      console.log(`Phone: ${interviewer.phone}`);
      console.log(`AC to assign: ${acCode} (${acName})`);
      
      try {
        // Find next available member ID
        const memberId = await findNextAvailableMemberId(currentMemberId);
        console.log(`✅ Using Member ID: ${memberId}`);
        currentMemberId = parseInt(memberId) + 1;
        
        // Create interviewer
        console.log(`\n📝 Creating interviewer...`);
        const newInterviewer = await createCATIInterviewer(
          interviewer,
          memberId,
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
        
        results.push({
          success: true,
          interviewer: {
            memberId: newInterviewer.memberId,
            firstName: newInterviewer.firstName,
            lastName: newInterviewer.lastName,
            phone: newInterviewer.phone,
            email: newInterviewer.email,
            userId: newInterviewer._id.toString()
          },
          ac: {
            code: acCode,
            name: acName
          }
        });
        
      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        results.push({
          success: false,
          interviewer: interviewer,
          error: error.message
        });
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    
    console.log(`✅ Successfully added: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}\n`);
    
    if (successCount > 0) {
      console.log('✅ Successfully Added Interviewers:\n');
      results.filter(r => r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.interviewer.firstName} ${result.interviewer.lastName}`);
        console.log(`   Member ID: ${result.interviewer.memberId}`);
        console.log(`   Phone: ${result.interviewer.phone}`);
        console.log(`   Email: ${result.interviewer.email}`);
        console.log(`   AC: ${result.ac.code} (${result.ac.name})`);
        console.log('');
      });
    }
    
    if (errorCount > 0) {
      console.log('❌ Errors:\n');
      results.filter(r => !r.success).forEach((result, index) => {
        console.log(`${index + 1}. ${result.interviewer.firstName} ${result.interviewer.lastName}`);
        console.log(`   Error: ${result.error}`);
        console.log('');
      });
    }
    
    // Generate CSV report
    const reportsDir = path.join(__dirname, '../scripts/reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const csvPath = path.join(reportsDir, `cati_interviewers_added_${timestamp}.csv`);
    
    const csvRows = [
      ['Status', 'Member ID', 'First Name', 'Last Name', 'Phone', 'Email', 'AC Code', 'AC Name'].join(',')
    ];
    
    results.forEach(result => {
      if (result.success) {
        const row = [
          'Success',
          result.interviewer.memberId,
          `"${result.interviewer.firstName.replace(/"/g, '""')}"`,
          `"${result.interviewer.lastName.replace(/"/g, '""')}"`,
          result.interviewer.phone,
          result.interviewer.email,
          result.ac.code,
          `"${result.ac.name.replace(/"/g, '""')}"`
        ].join(',');
        csvRows.push(row);
      } else {
        const row = [
          'Error',
          'N/A',
          `"${result.interviewer.firstName.replace(/"/g, '""')}"`,
          `"${result.interviewer.lastName.replace(/"/g, '""')}"`,
          result.interviewer.phone,
          'N/A',
          'N/A',
          `"${result.error.replace(/"/g, '""')}"`
        ].join(',');
        csvRows.push(row);
      }
    });
    
    fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
    console.log(`💾 CSV report saved to: ${csvPath}\n`);
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

main();

