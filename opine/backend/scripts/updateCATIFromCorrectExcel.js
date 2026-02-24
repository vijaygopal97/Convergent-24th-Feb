/**
 * Update CATI Interviewers from CORRECT Excel File and Assign ACs
 * 
 * This script:
 * 1. Reads the CORRECT Excel file (2App QC id.xlsx) with actual phone numbers
 * 2. Finds quality agents by email/QC ID
 * 3. Updates existing CATI interviewers or creates new ones
 * 4. Updates phone numbers and passwords from the Number column
 * 5. Assigns ACs to interviewers (one AC per interviewer, removes existing ACs)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

const SURVEY_ID = '68fd1915d41841da463f0d46';
const COMPANY_CODE = 'TEST001';
const EXCEL_FILE = '/var/www/reports/2App QC id.xlsx';

// AC codes to assign (one per interviewer)
const AC_CODES = ['WB011', 'WB171', 'WB242', 'WB241', 'WB235', 'WB222', 'WB019'];

// Report file paths
const REPORT_DIR = path.join(__dirname, '../../reports');
const REPORT_FILE = path.join(REPORT_DIR, `cati-update-correct-excel-${Date.now()}.json`);
const REVERSAL_SCRIPT = path.join(REPORT_DIR, `reverse-cati-update-correct-excel-${Date.now()}.js`);

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

/**
 * Read Excel file and extract user data with phone numbers from Number column
 */
function readExcelFile() {
  try {
    const pythonScriptPath = path.join(__dirname, '../../reports/temp_read_correct_excel.py');
    const pythonScript = `import pandas as pd
import json

df = pd.read_excel('${EXCEL_FILE}')

def extract_phone_from_email(email):
    if '@' in str(email):
        phone_part = str(email).split('@')[0]
        if phone_part.isdigit() and len(phone_part) == 10:
            return phone_part
    return None

def format_phone_number(num):
    if pd.isna(num):
        return None
    try:
        phone = str(int(float(num)))
        if len(phone) == 10:
            return phone
        elif len(phone) > 10:
            return phone[-10:]
        else:
            return None
    except:
        return None

users = []
for _, row in df.iterrows():
    email = str(row['Email']).lower()
    qc_id = row['QC id'] if pd.notna(row['QC id']) else None
    phone_from_email = extract_phone_from_email(email)
    phone_from_number = format_phone_number(row.get('Number', None))
    
    # Priority: Number column > phone from email > None
    actual_phone = phone_from_number or phone_from_email
    
    users.append({
        'name': str(row['Name']),
        'email': email,
        'qc_id': int(qc_id) if qc_id else None,
        'phone': actual_phone,
        'phone_source': 'Number column' if phone_from_number else ('email' if phone_from_email else 'none')
    })

print(json.dumps(users))
`;

    fs.writeFileSync(pythonScriptPath, pythonScript);
    
    const result = execSync(`python3 ${pythonScriptPath}`, {
      cwd: '/var/www/reports',
      encoding: 'utf-8'
    });

    // Clean up temp file
    try {
      fs.unlinkSync(pythonScriptPath);
    } catch (e) {}

    return JSON.parse(result);
  } catch (error) {
    console.error('Error reading Excel file:', error.message);
    throw error;
  }
}

/**
 * Load AC JSON and get AC name from code
 */
function loadACJson() {
  const acJsonPath = path.join(__dirname, '../data/assemblyConstituencies.json');
  const data = JSON.parse(fs.readFileSync(acJsonPath, 'utf8'));
  const wbACs = data.states['West Bengal'].assemblyConstituencies;
  
  const acMap = {};
  wbACs.forEach(ac => {
    acMap[ac.acCode] = ac.acName;
  });
  
  return acMap;
}

/**
 * Format AC code (e.g., WB19 -> WB019)
 */
function formatACCode(acCode) {
  if (acCode.startsWith('WB')) {
    const num = acCode.replace('WB', '');
    const padded = num.padStart(3, '0');
    return `WB${padded}`;
  }
  return acCode;
}

/**
 * Get AC name from code
 */
function getACName(acCode, acMap) {
  const formatted = formatACCode(acCode);
  return acMap[formatted] || null;
}

/**
 * Modify phone number by changing last digit
 */
function modifyPhoneNumber(phone) {
  if (!phone || phone.length < 10) return phone;
  const lastDigit = parseInt(phone[phone.length - 1]);
  const newLastDigit = (lastDigit + 1) % 10;
  return phone.slice(0, -1) + newLastDigit;
}

/**
 * Get QA-cati-ID or use memberId
 */
function getCatiMemberId(qualityAgent) {
  const catiId = qualityAgent['QA-cati-ID'] || qualityAgent.memberId;
  return `CATI${catiId}`;
}

/**
 * Update or create CATI interviewer
 */
async function updateOrCreateCATIInterviewer(userData, qualityAgent, acCode, acName, companyAdmin, referenceUser) {
  const User = require('../models/User');
  const Survey = require('../models/Survey');

  // Determine CATI memberId
  const catiMemberId = getCatiMemberId(qualityAgent);
  
  // Get actual phone number from Excel
  let actualPhone = userData.phone;
  
  if (!actualPhone) {
    // Fallback to QA phone if Excel doesn't have it
    if (qualityAgent.phone) {
      actualPhone = qualityAgent.phone;
    } else {
      throw new Error(`No phone number found for ${userData.name}`);
    }
  }

  // Normalize phone (remove country code)
  actualPhone = actualPhone.replace(/^\+91/, '').replace(/^91/, '').trim();
  if (actualPhone.length !== 10) {
    throw new Error(`Invalid phone number: ${actualPhone}`);
  }

  // Check if CATI interviewer already exists
  let catiInterviewer = await User.findOne({
    $or: [
      { memberId: catiMemberId },
      { email: `cati${catiMemberId.toLowerCase()}@gmail.com` }
    ]
  }).select('+password').lean();

  const isNew = !catiInterviewer;
  const changes = {
    phoneUpdated: false,
    passwordUpdated: false,
    created: isNew
  };

  if (catiInterviewer) {
    // Update existing
    const updateData = {};
    
    // Update phone if different
    if (catiInterviewer.phone !== actualPhone) {
      updateData.phone = actualPhone;
      changes.phoneUpdated = true;
    }
    
    // Update password to match phone
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(actualPhone, salt);
    updateData.password = hashedPassword;
    changes.passwordUpdated = true;
    
    if (Object.keys(updateData).length > 0) {
      await User.updateOne(
        { _id: catiInterviewer._id },
        { $set: updateData }
      );
      catiInterviewer = await User.findById(catiInterviewer._id).select('+password').lean();
    }
  } else {
    // Create new CATI interviewer
    const catiEmail = `cati${catiMemberId.toLowerCase()}@gmail.com`;
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(actualPhone, salt);

    const newInterviewer = new User({
      firstName: qualityAgent.firstName,
      lastName: qualityAgent.lastName,
      email: catiEmail,
      phone: actualPhone,
      password: hashedPassword,
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      canSelectMode: false,
      company: qualityAgent.company || referenceUser?.company,
      companyCode: qualityAgent.companyCode || COMPANY_CODE,
      memberId: catiMemberId,
      status: 'active',
      isActive: true,
      isEmailVerified: qualityAgent.isEmailVerified || false,
      isPhoneVerified: qualityAgent.isPhoneVerified || false,
      profile: qualityAgent.profile || referenceUser?.profile || {
        languages: [],
        education: [],
        experience: []
      },
      documents: qualityAgent.documents || referenceUser?.documents || {
        aadhaar: { isVerified: false },
        pan: { isVerified: false },
        drivingLicense: { isVerified: false },
        bankDetails: { isVerified: false }
      },
      interviewerProfile: referenceUser?.interviewerProfile || {
        approvalStatus: 'approved',
        approvalFeedback: 'Approved for CATI',
        approvedBy: companyAdmin._id,
        approvedAt: new Date(),
        lastSubmittedAt: new Date()
      },
      performance: {
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
      gig_enabled: false,
      gig_availability: false,
      registrationSource: 'company_admin'
    });

    await newInterviewer.save();
    catiInterviewer = await User.findById(newInterviewer._id).select('+password').lean();
  }

  // Handle QA phone modification if needed
  let qaPhoneModified = false;
  let qaPhoneModifiedTo = null;
  
  // Check if QA phone needs to be modified (if same as CATI phone)
  if (qualityAgent.phone === actualPhone) {
    const modifiedPhone = modifyPhoneNumber(actualPhone);
    await User.updateOne(
      { _id: qualityAgent._id },
      { $set: { phone: modifiedPhone } }
    );
    qaPhoneModified = true;
    qaPhoneModifiedTo = modifiedPhone;
  }

  // Assign to survey and assign AC
  const survey = await Survey.findById(SURVEY_ID);
  if (!survey) {
    throw new Error(`Survey ${SURVEY_ID} not found`);
  }

  if (!survey.catiInterviewers) {
    survey.catiInterviewers = [];
  }

  // Find or create assignment
  let assignment = survey.catiInterviewers.find(
    a => a.interviewer && a.interviewer.toString() === catiInterviewer._id.toString()
  );

  if (!assignment) {
    assignment = {
      interviewer: catiInterviewer._id,
      assignedBy: companyAdmin._id,
      assignedAt: new Date(),
      assignedACs: [],
      status: 'assigned',
      maxInterviews: 0,
      completedInterviews: 0
    };
    survey.catiInterviewers.push(assignment);
  }

  // Remove existing ACs and assign new AC
  assignment.assignedACs = [acName]; // One AC per interviewer
  assignment.assignedBy = companyAdmin._id;
  assignment.assignedAt = new Date();

  await survey.save();

  return {
    catiInterviewer,
    changes,
    acAssigned: acName,
    acCode: formatACCode(acCode),
    qaPhoneModified,
    qaPhoneModifiedTo
  };
}

async function main() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = require('../models/User');
    const Survey = require('../models/Survey');

    // Load AC map
    console.log('📖 Loading AC mappings...');
    const acMap = loadACJson();
    console.log(`✅ Loaded ${Object.keys(acMap).length} AC mappings\n`);

    // Read Excel file
    console.log('📖 Reading CORRECT Excel file...');
    const excelUsers = readExcelFile();
    console.log(`✅ Found ${excelUsers.length} users in Excel\n`);

    // Get default survey
    const survey = await Survey.findById(SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName}\n`);

    // Get company admin
    const companyAdmin = await User.findOne({
      userType: 'company_admin',
      companyCode: COMPANY_CODE,
      status: 'active'
    });

    if (!companyAdmin) {
      throw new Error(`Company admin not found for ${COMPANY_CODE}`);
    }

    // Get reference user
    const referenceUser = await User.findOne({
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      status: 'active'
    }).limit(1);

    const stats = {
      total: excelUsers.length,
      found: 0,
      created: 0,
      updated: 0,
      errors: 0
    };

    const report = {
      timestamp: new Date().toISOString(),
      surveyId: SURVEY_ID,
      surveyName: survey.surveyName,
      changes: [],
      statistics: stats
    };

    console.log('🔄 Processing users...\n');
    console.log('='.repeat(70));

    // Distribute ACs to users
    let acIndex = 0;

    for (let i = 0; i < excelUsers.length; i++) {
      const userData = excelUsers[i];
      
      try {
        console.log(`\n📋 Processing ${i + 1}/${excelUsers.length}: ${userData.name} (${userData.email})`);

        // Find quality agent
        const qualityAgent = await User.findOne({
          $or: [
            { email: userData.email },
            { memberId: userData.qc_id ? String(userData.qc_id) : null }
          ]
        }).select('+password').lean();

        if (!qualityAgent) {
          console.log(`⚠️  Quality agent not found: ${userData.email}`);
          stats.errors++;
          continue;
        }

        stats.found++;

        // Get phone number from Excel
        let actualPhone = userData.phone;

        if (!actualPhone) {
          console.log(`⚠️  No phone number in Excel for ${userData.name}, using QA phone`);
          if (qualityAgent.phone) {
            actualPhone = qualityAgent.phone;
          } else {
            console.log(`⚠️  No phone number found for ${userData.name}`);
            stats.errors++;
            continue;
          }
        }

        // Normalize phone
        actualPhone = actualPhone.replace(/^\+91/, '').replace(/^91/, '').trim();
        if (actualPhone.length !== 10) {
          console.log(`⚠️  Invalid phone number: ${actualPhone}`);
          stats.errors++;
          continue;
        }

        // Get AC code (distribute evenly)
        const acCode = AC_CODES[acIndex % AC_CODES.length];
        const acName = getACName(acCode, acMap);
        
        if (!acName) {
          console.log(`⚠️  AC name not found for code: ${acCode}`);
          stats.errors++;
          continue;
        }

        acIndex++;

        console.log(`   Phone: ${actualPhone} (from ${userData.phone_source})`);
        console.log(`   AC: ${acName} (${formatACCode(acCode)})`);

        // Update or create CATI interviewer
        const result = await updateOrCreateCATIInterviewer(
          userData,
          qualityAgent,
          acCode,
          acName,
          companyAdmin,
          referenceUser
        );

        if (result.changes.created) {
          stats.created++;
          console.log(`   ✅ Created CATI interviewer: ${result.catiInterviewer.memberId}`);
        } else {
          stats.updated++;
          console.log(`   ✅ Updated CATI interviewer: ${result.catiInterviewer.memberId}`);
        }

        if (result.changes.phoneUpdated) {
          console.log(`   ✅ Phone updated`);
        }
        if (result.changes.passwordUpdated) {
          console.log(`   ✅ Password updated`);
        }
        if (result.qaPhoneModified) {
          console.log(`   ✅ QA phone modified to: ${result.qaPhoneModifiedTo}`);
        }

        console.log(`   ✅ AC assigned: ${acName}`);

        // Add to report
        report.changes.push({
          qualityAgent: {
            _id: qualityAgent._id.toString(),
            name: `${qualityAgent.firstName} ${qualityAgent.lastName}`,
            email: qualityAgent.email,
            originalPhone: qualityAgent.phone,
            memberId: qualityAgent.memberId,
            qaCatiId: qualityAgent['QA-cati-ID'] || null
          },
          catiInterviewer: {
            _id: result.catiInterviewer._id.toString(),
            name: `${result.catiInterviewer.firstName} ${result.catiInterviewer.lastName}`,
            email: result.catiInterviewer.email,
            phone: result.catiInterviewer.phone,
            memberId: result.catiInterviewer.memberId,
            password: result.catiInterviewer.phone // Password is phone number
          },
          changes: result.changes,
          acAssignment: {
            acCode: result.acCode,
            acName: result.acAssigned
          },
          qaPhoneModified: result.qaPhoneModified,
          qaPhoneModifiedTo: result.qaPhoneModifiedTo,
          phoneSource: userData.phone_source,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error(`\n   ❌ Error processing ${userData.name}:`, error.message);
        stats.errors++;
      }
    }

    // Update final statistics
    report.statistics = stats;
    report.completedAt = new Date().toISOString();

    // Save report
    console.log('\n' + '='.repeat(70));
    console.log('💾 Saving report...');
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`✅ Report saved to: ${REPORT_FILE}`);

    // Generate reversal script
    console.log('\n📝 Generating reversal script...');
    const reversalScript = generateReversalScript(report, REVERSAL_SCRIPT);
    fs.writeFileSync(REVERSAL_SCRIPT, reversalScript);
    console.log(`✅ Reversal script saved to: ${REVERSAL_SCRIPT}`);

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total users in Excel: ${stats.total}`);
    console.log(`Found quality agents: ${stats.found}`);
    console.log(`✅ Created: ${stats.created}`);
    console.log(`✅ Updated: ${stats.updated}`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log('\n📄 Report:', REPORT_FILE);
    console.log('🔄 Reversal script:', REVERSAL_SCRIPT);
    console.log('='.repeat(70));

    await mongoose.disconnect();
    console.log('\n✅ Process completed successfully!');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

function generateReversalScript(report, scriptPath) {
  const scriptName = path.basename(scriptPath);
  const reportName = path.basename(REPORT_FILE);

  return `/**
 * Reversal Script: Revert CATI Interviewer Updates from CORRECT Excel
 * 
 * Generated: ${report.timestamp}
 * Report: ${reportName}
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const REPORT_FILE = path.join(__dirname, '${reportName}');

async function reverse() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const User = require('../models/User');
    const Survey = require('../models/Survey');

    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
    const stats = { restored: 0, removed: 0, errors: 0 };

    for (const change of report.changes) {
      try {
        // Restore QA phone if modified
        if (change.qaPhoneModified && change.qaPhoneModifiedTo) {
          const qa = await User.findById(change.qualityAgent._id);
          if (qa) {
            await User.updateOne(
              { _id: qa._id },
              { $set: { phone: change.qualityAgent.originalPhone } }
            );
            stats.restored++;
          }
        }

        // Remove CATI interviewer if created
        if (change.changes.created) {
          await User.deleteOne({ _id: change.catiInterviewer._id });
          stats.removed++;
        }

        // Remove AC assignment
        const survey = await Survey.findById(report.surveyId);
        if (survey && survey.catiInterviewers) {
          const assignment = survey.catiInterviewers.find(
            a => a.interviewer && a.interviewer.toString() === change.catiInterviewer._id
          );
          if (assignment) {
            assignment.assignedACs = [];
            await survey.save();
          }
        }
      } catch (err) {
        stats.errors++;
      }
    }

    console.log('Reversal complete:', stats);
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

reverse();
`;
}

if (require.main === module) {
  main();
}

module.exports = { main };




