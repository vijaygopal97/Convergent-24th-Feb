/**
 * Create CATI Interviewers from Quality Agents
 * 
 * This script:
 * 1. Finds quality agents by email/memberId
 * 2. Gets their QA-cati-ID or uses memberId
 * 3. Modifies quality agent phone (changes last digit) to avoid conflict
 * 4. Creates CATI interviewer account with CATI prefix memberId
 * 5. Uses original quality agent phone for CATI interviewer
 * 6. Assigns to default survey
 * 7. Generates reversal report
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SURVEY_ID = '68fd1915d41841da463f0d46';
const COMPANY_CODE = 'TEST001';

// Quality agents to convert
const QUALITY_AGENTS = [
  { name: 'Ravindranath Basak', email: '1018@gmail.com', memberId: '1018' },
  { name: 'Subroto Das', email: '1016@gmail.com', memberId: '1016' },
  { name: 'Souvik Saha', email: '1017@gmail.com', memberId: '1017' },
  { name: 'Jaidev Haldhar', email: '1006@gmail.com', memberId: '1006' },
  { name: 'Anima Ghosh', email: '1015@gmail.com', memberId: '1015' },
  { name: 'Priyanka Haldar', email: '1001@gmail.com', memberId: '1001' }
];

// Report file paths
const REPORT_DIR = path.join(__dirname, '../../reports');
const REPORT_FILE = path.join(REPORT_DIR, `cati-interviewers-from-qa-${Date.now()}.json`);
const REVERSAL_SCRIPT = path.join(REPORT_DIR, `reverse-cati-interviewers-from-qa-${Date.now()}.js`);

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

/**
 * Modify phone number by changing last digit
 */
function modifyPhoneNumber(phone) {
  if (!phone || phone.length < 10) return phone;
  
  const lastDigit = parseInt(phone[phone.length - 1]);
  const newLastDigit = (lastDigit + 1) % 10; // Change to next digit (0-9)
  
  return phone.slice(0, -1) + newLastDigit;
}

/**
 * Get QA-cati-ID or use memberId
 */
function getCatiMemberId(qualityAgent) {
  // Use QA-cati-ID if exists, otherwise use memberId
  const catiId = qualityAgent['QA-cati-ID'] || qualityAgent.memberId;
  return `CATI${catiId}`;
}

async function main() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = require('../models/User');
    const Survey = require('../models/Survey');

    // Get default survey
    console.log(`📋 Fetching default survey: ${SURVEY_ID}...`);
    const survey = await Survey.findById(SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName}\n`);

    // Get company admin for assignment
    const companyAdmin = await User.findOne({
      userType: 'company_admin',
      companyCode: COMPANY_CODE,
      status: 'active'
    });

    if (!companyAdmin) {
      throw new Error(`Company admin not found for ${COMPANY_CODE}`);
    }
    console.log(`✅ Found company admin: ${companyAdmin.firstName} ${companyAdmin.lastName}\n`);

    // Get reference user for default values
    const referenceUser = await User.findOne({
      userType: 'interviewer',
      interviewModes: 'CATI (Telephonic interview)',
      status: 'active'
    }).limit(1);

    if (!referenceUser) {
      console.log('⚠️  No reference interviewer found, will use defaults\n');
    } else {
      console.log(`✅ Found reference interviewer: ${referenceUser.firstName} ${referenceUser.lastName}\n`);
    }

    const stats = {
      total: QUALITY_AGENTS.length,
      found: 0,
      created: 0,
      alreadyExists: 0,
      errors: 0
    };

    const report = {
      timestamp: new Date().toISOString(),
      surveyId: SURVEY_ID,
      surveyName: survey.surveyName,
      changes: [],
      statistics: stats
    };

    console.log('🔄 Processing quality agents...\n');
    console.log('='.repeat(70));

    for (const qaInfo of QUALITY_AGENTS) {
      try {
        console.log(`\n📋 Processing: ${qaInfo.name} (${qaInfo.email})`);

        // Find quality agent
        const qualityAgent = await User.findOne({
          $or: [
            { email: qaInfo.email.toLowerCase() },
            { memberId: qaInfo.memberId }
          ]
        }).select('+password').lean();

        if (!qualityAgent) {
          console.log(`❌ Quality agent not found: ${qaInfo.email}`);
          stats.errors++;
          continue;
        }

        if (qualityAgent.userType !== 'quality_agent') {
          console.log(`⚠️  User is not a quality agent (userType: ${qualityAgent.userType})`);
        }

        stats.found++;
        console.log(`✅ Found quality agent: ${qualityAgent.firstName} ${qualityAgent.lastName}`);
        console.log(`   Current phone: ${qualityAgent.phone}`);
        console.log(`   Current memberId: ${qualityAgent.memberId}`);
        console.log(`   QA-cati-ID: ${qualityAgent['QA-cati-ID'] || 'N/A'}`);

        // Determine CATI memberId
        const catiMemberId = getCatiMemberId(qualityAgent);
        console.log(`   CATI memberId will be: ${catiMemberId}`);

        // Check if CATI interviewer already exists
        const existingInterviewer = await User.findOne({
          $or: [
            { memberId: catiMemberId },
            { email: `cati${catiMemberId.toLowerCase()}@gmail.com` }
          ]
        }).lean();

        if (existingInterviewer) {
          console.log(`⚠️  CATI interviewer already exists with memberId: ${catiMemberId}`);
          console.log(`   Existing: ${existingInterviewer.firstName} ${existingInterviewer.lastName}`);
          stats.alreadyExists++;
          continue;
        }

        // Check if phone is already used by another interviewer
        const phoneInUse = await User.findOne({
          phone: qualityAgent.phone,
          userType: 'interviewer',
          _id: { $ne: qualityAgent._id }
        }).lean();

        if (phoneInUse) {
          console.log(`⚠️  Phone ${qualityAgent.phone} already used by interviewer: ${phoneInUse.firstName} ${phoneInUse.lastName}`);
          console.log(`   Will modify quality agent phone before creating CATI interviewer`);
        }

        // Store original state
        const originalPhone = qualityAgent.phone;
        const modifiedPhone = modifyPhoneNumber(originalPhone);
        console.log(`   Original phone: ${originalPhone}`);
        console.log(`   Modified phone (for QA): ${modifiedPhone}`);

        // Step 1: Modify quality agent phone
        console.log(`\n   🔄 Step 1: Modifying quality agent phone...`);
        await User.updateOne(
          { _id: qualityAgent._id },
          { $set: { phone: modifiedPhone } }
        );
        console.log(`   ✅ Quality agent phone updated to: ${modifiedPhone}`);

        // Step 2: Create CATI interviewer
        console.log(`\n   🔄 Step 2: Creating CATI interviewer...`);
        
        const catiEmail = `cati${catiMemberId.toLowerCase()}@gmail.com`;
        const catiPassword = originalPhone; // Use original phone as password

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(catiPassword, salt);

        // Create interviewer account
        const newInterviewer = new User({
          firstName: qualityAgent.firstName,
          lastName: qualityAgent.lastName,
          email: catiEmail,
          phone: originalPhone, // Use original phone
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
        console.log(`   ✅ CATI interviewer created: ${newInterviewer.firstName} ${newInterviewer.lastName}`);
        console.log(`      Email: ${catiEmail}`);
        console.log(`      Phone: ${originalPhone}`);
        console.log(`      memberId: ${catiMemberId}`);

        // Step 3: Assign to survey
        console.log(`\n   🔄 Step 3: Assigning to survey...`);
        
        // Check if already assigned
        const existingAssignment = survey.catiInterviewers?.find(
          a => a.interviewer && a.interviewer.toString() === newInterviewer._id.toString()
        );

        if (existingAssignment) {
          console.log(`   ⚠️  Already assigned to survey`);
        } else {
          if (!survey.catiInterviewers) {
            survey.catiInterviewers = [];
          }

          survey.catiInterviewers.push({
            interviewer: newInterviewer._id,
            assignedBy: companyAdmin._id,
            assignedAt: new Date(),
            status: 'assigned',
            maxInterviews: 0,
            completedInterviews: 0
          });

          await survey.save();
          console.log(`   ✅ Assigned to survey: ${survey.surveyName}`);
        }

        stats.created++;

        // Add to report
        report.changes.push({
          qualityAgent: {
            _id: qualityAgent._id.toString(),
            name: `${qualityAgent.firstName} ${qualityAgent.lastName}`,
            email: qualityAgent.email,
            originalPhone: originalPhone,
            modifiedPhone: modifiedPhone,
            memberId: qualityAgent.memberId,
            qaCatiId: qualityAgent['QA-cati-ID'] || null
          },
          catiInterviewer: {
            _id: newInterviewer._id.toString(),
            name: `${newInterviewer.firstName} ${newInterviewer.lastName}`,
            email: catiEmail,
            phone: originalPhone,
            memberId: catiMemberId,
            password: catiPassword // Store for reference (will be hashed in DB)
          },
          surveyAssignment: {
            surveyId: SURVEY_ID,
            surveyName: survey.surveyName,
            assigned: !existingAssignment
          },
          timestamp: new Date().toISOString()
        });

        console.log(`\n   ✅ Completed: ${qaInfo.name}`);

      } catch (error) {
        console.error(`\n   ❌ Error processing ${qaInfo.name}:`, error.message);
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
    console.log(`Total quality agents: ${stats.total}`);
    console.log(`Found: ${stats.found}`);
    console.log(`✅ Created: ${stats.created}`);
    console.log(`⏭️  Already exists: ${stats.alreadyExists}`);
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
 * Reversal Script: Remove CATI Interviewers and Restore Quality Agent Phones
 * 
 * This script reverses the changes made by createCATIInterviewersFromQualityAgents.js
 * 
 * Generated: ${report.timestamp}
 * Report: ${reportName}
 * 
 * Usage: node ${scriptName}
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const REPORT_FILE = path.join(__dirname, '${reportName}');

async function reverse() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const User = require('../models/User');
    const Survey = require('../models/Survey');

    // Load report
    console.log('\\n📖 Loading report...');
    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
    console.log(\`✅ Loaded report with \${report.changes.length} changes\`);

    const stats = {
      total: report.changes.length,
      qaPhonesRestored: 0,
      catiInterviewersRemoved: 0,
      surveyAssignmentsRemoved: 0,
      notFound: 0,
      errors: 0
    };

    console.log('\\n🔄 Reversing changes...');

    for (let i = 0; i < report.changes.length; i++) {
      const change = report.changes[i];
      
      console.log(\`\\n\${i + 1}. Processing: \${change.qualityAgent.name}\`);

      try {
        // Step 1: Restore quality agent phone
        const qa = await User.findById(change.qualityAgent._id);
        if (qa) {
          await User.updateOne(
            { _id: qa._id },
            { $set: { phone: change.qualityAgent.originalPhone } }
          );
          console.log(\`   ✅ Restored QA phone: \${change.qualityAgent.originalPhone}\`);
          stats.qaPhonesRestored++;
        } else {
          console.log(\`   ⚠️  Quality agent not found: \${change.qualityAgent._id}\`);
          stats.notFound++;
        }

        // Step 2: Remove CATI interviewer
        const catiInterviewer = await User.findById(change.catiInterviewer._id);
        if (catiInterviewer) {
          await User.deleteOne({ _id: catiInterviewer._id });
          console.log(\`   ✅ Removed CATI interviewer: \${change.catiInterviewer.memberId}\`);
          stats.catiInterviewersRemoved++;
        } else {
          console.log(\`   ⚠️  CATI interviewer not found: \${change.catiInterviewer._id}\`);
          stats.notFound++;
        }

        // Step 3: Remove from survey assignment
        if (change.surveyAssignment.assigned) {
          const survey = await Survey.findById(report.surveyId);
          if (survey && survey.catiInterviewers) {
            const assignmentIndex = survey.catiInterviewers.findIndex(
              a => a.interviewer && a.interviewer.toString() === change.catiInterviewer._id
            );
            
            if (assignmentIndex !== -1) {
              survey.catiInterviewers.splice(assignmentIndex, 1);
              await survey.save();
              console.log(\`   ✅ Removed from survey assignment\`);
              stats.surveyAssignmentsRemoved++;
            }
          }
        }

      } catch (err) {
        console.error(\`   ❌ Error reversing \${change.qualityAgent.name}:\`, err.message);
        stats.errors++;
      }
    }

    console.log('\\n' + '='.repeat(70));
    console.log('📊 REVERSAL SUMMARY');
    console.log('='.repeat(70));
    console.log(\`Total changes to reverse: \${stats.total}\`);
    console.log(\`✅ QA phones restored: \${stats.qaPhonesRestored}\`);
    console.log(\`✅ CATI interviewers removed: \${stats.catiInterviewersRemoved}\`);
    console.log(\`✅ Survey assignments removed: \${stats.surveyAssignmentsRemoved}\`);
    console.log(\`❌ Errors: \${stats.errors}\`);
    console.log(\`📦 Not found: \${stats.notFound}\`);
    console.log('='.repeat(70));

    await mongoose.disconnect();
    console.log('\\n✅ Reversal completed successfully!');

  } catch (error) {
    console.error('\\n❌ Fatal error:', error);
    process.exit(1);
  }
}

reverse();
`;
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };




