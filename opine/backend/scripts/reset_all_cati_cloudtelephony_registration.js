#!/usr/bin/env node

/**
 * Reset Cloud Telephony Registration for ALL CATI Interviewers
 * 
 * This script resets the Cloud Telephony registration status for all CATI interviewers
 * assigned to the default survey, allowing them to be re-registered when they start
 * their next CATI interview.
 * 
 * Usage: node scripts/reset_all_cati_cloudtelephony_registration.js [surveyId]
 * Example: node scripts/reset_all_cati_cloudtelephony_registration.js
 * Example: node scripts/reset_all_cati_cloudtelephony_registration.js 68fd1915d41841da463f0d46
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Survey = require('../models/Survey');
const CatiAgent = require('../models/CatiAgent');
const { invalidateCachedRegistrationStatus } = require('../utils/catiAgentCache');

const DEFAULT_SURVEY_ID = '68fd1915d41841da463f0d46';

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
};

/**
 * Normalize phone number (remove non-digits)
 */
const normalizePhone = (phone) => {
  if (!phone) return null;
  return phone.replace(/[^0-9]/g, '');
};

/**
 * Reset CloudTelephony registration for all CATI interviewers
 */
const resetAllCatiRegistrations = async (surveyId) => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('RESET CLOUDTELEPHONY REGISTRATION FOR ALL CATI INTERVIEWERS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${surveyId}\n`);

    // Get survey with populated interviewers
    const survey = await Survey.findById(surveyId)
      .populate('catiInterviewers.interviewer', 'memberId firstName lastName phone email')
      .lean();

    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }

    console.log(`✅ Survey: ${survey.surveyName}`);
    
    if (!survey.catiInterviewers || survey.catiInterviewers.length === 0) {
      console.log('\n⚠️  No CATI interviewers found in this survey');
      return { total: 0, reset: 0, skipped: 0, errors: 0 };
    }

    console.log(`\n📋 Found ${survey.catiInterviewers.length} CATI interviewer(s) assigned to survey\n`);

    let resetCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each interviewer
    for (let i = 0; i < survey.catiInterviewers.length; i++) {
      const assignment = survey.catiInterviewers[i];
      const interviewer = assignment.interviewer;

      if (!interviewer) {
        console.log(`⚠️  [${i + 1}/${survey.catiInterviewers.length}] Assignment has no interviewer - skipping`);
        skippedCount++;
        continue;
      }

      const interviewerId = interviewer._id || interviewer;
      const memberId = interviewer.memberId || 'N/A';
      const name = `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim() || 'N/A';
      const phone = interviewer.phone || null;

      console.log(`\n[${i + 1}/${survey.catiInterviewers.length}] Processing: ${name}`);
      console.log(`   Member ID: ${memberId}`);
      console.log(`   Phone: ${phone || 'N/A'}`);
      console.log(`   Status: ${assignment.status || 'N/A'}`);

      if (!phone) {
        console.log('   ⚠️  No phone number - skipping');
        skippedCount++;
        continue;
      }

      try {
        // Normalize phone number
        const cleanPhone = normalizePhone(phone);
        if (!cleanPhone || cleanPhone.length < 10) {
          console.log(`   ⚠️  Invalid phone number (${phone}) - skipping`);
          skippedCount++;
          continue;
        }

        // Find CatiAgent record for this user
        const agent = await CatiAgent.findOne({ 
          user: interviewerId,
          phone: cleanPhone 
        });

        if (!agent) {
          console.log('   ⚠️  No CatiAgent record found - skipping');
          skippedCount++;
          continue;
        }

        console.log('   📋 Current CatiAgent status:');
        const wasRegistered = agent.providers?.cloudtelephony?.registered === true;
        console.log(`      Registered: ${wasRegistered}`);
        console.log(`      Registered At: ${agent.providers?.cloudtelephony?.registeredAt || 'N/A'}`);
        console.log(`      Agent ID: ${agent.providers?.cloudtelephony?.agentId || 'N/A'}`);

        // Reset registration
        if (!agent.providers) {
          agent.providers = {};
        }
        if (!agent.providers.cloudtelephony) {
          agent.providers.cloudtelephony = {};
        }

        agent.providers.cloudtelephony.registered = false;
        agent.providers.cloudtelephony.registeredAt = null;
        agent.providers.cloudtelephony.agentId = null;
        agent.providers.cloudtelephony.lastChecked = null;
        agent.markModified('providers');
        await agent.save();

        console.log('   ✅ RESET COMPLETE:');
        console.log('      CloudTelephony Registered: false');
        console.log('      Registered At: cleared');
        console.log('      Agent ID: cleared');
        console.log('      Last Checked: cleared');

        if (wasRegistered) {
          console.log('      📝 Status changed from registered to unregistered.');
          resetCount++;
        } else {
          console.log('      ℹ️  User was already unregistered.');
          skippedCount++;
        }

        // Clear Redis cache for this user
        try {
          await invalidateCachedRegistrationStatus(
            interviewerId.toString(),
            agent.phone || cleanPhone,
            'cloudtelephony'
          );
          console.log('      ✅ Redis cache cleared');
        } catch (cacheError) {
          console.warn(`      ⚠️  Error clearing Redis cache: ${cacheError.message}`);
          // Non-critical - continue
        }

      } catch (error) {
        console.error(`   ❌ Error processing interviewer: ${error.message}`);
        errorCount++;
        errors.push({
          interviewer: name,
          memberId: memberId,
          phone: phone,
          error: error.message
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total CATI interviewers: ${survey.catiInterviewers.length}`);
    console.log(`✅ Successfully reset: ${resetCount}`);
    console.log(`⚠️  Skipped (no agent/already unregistered/no phone): ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    if (errors.length > 0) {
      console.log('\n📋 Errors encountered:');
      errors.forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.interviewer} (${err.memberId}): ${err.error}`);
      });
    }

    console.log('\n📝 Next time these interviewers start a CATI interview,');
    console.log('   the system will detect registered=false and re-register them');
    console.log('   via the CloudTelephony Add Member API.\n');

    return {
      total: survey.catiInterviewers.length,
      reset: resetCount,
      skipped: skippedCount,
      errors: errorCount
    };

  } catch (error) {
    console.error('❌ Error resetting registrations:', error.message);
    throw error;
  }
};

const main = async () => {
  const surveyId = process.argv[2] || DEFAULT_SURVEY_ID;

  try {
    await connectDB();
    const result = await resetAllCatiRegistrations(surveyId);

    if (result.reset > 0 || result.skipped > 0) {
      console.log('\n✅ Reset process completed!');
    } else if (result.total === 0) {
      console.log('\n⚠️  No CATI interviewers found to process');
    } else {
      console.log('\n⚠️  No registrations were reset (all were already unregistered or had no CatiAgent records)');
    }
  } catch (error) {
    console.error('\n❌ Reset process failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
};

main();

















