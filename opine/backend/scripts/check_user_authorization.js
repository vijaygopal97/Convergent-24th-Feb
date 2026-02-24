#!/usr/bin/env node

/**
 * Check User Authorization for Survey Interview
 * 
 * This script checks why a user might be getting "Not Authorised to Access This Route"
 * when trying to start an interview.
 */

const mongoose = require('mongoose');
const path = require('path');

const User = require('../models/User');
const Survey = require('../models/Survey');
const Company = require('../models/Company');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function checkUserAuthorization() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const phoneNumber = '8420045700';
    const surveyId = '68fd1915d41841da463f0d46';
    
    console.log('='.repeat(80));
    console.log('USER AUTHORIZATION CHECK');
    console.log('='.repeat(80));
    console.log(`Phone Number: ${phoneNumber}`);
    console.log(`Survey ID: ${surveyId}\n`);
    
    // Find user by phone number
    const phoneVariations = [
      phoneNumber,
      `+${phoneNumber}`,
      `+91${phoneNumber}`,
      `91${phoneNumber}`
    ];
    
    console.log('🔍 Searching for user...');
    const user = await User.findOne({
      $or: phoneVariations.map(p => ({ phone: p }))
    })
    .populate('company', 'companyName companyCode')
    .lean();
    
    if (!user) {
      console.log('❌ User not found with phone number:', phoneNumber);
      console.log('   Searched variations:', phoneVariations);
      await mongoose.disconnect();
      return;
    }
    
    console.log('✅ User found:');
    console.log(`   User ID: ${user._id}`);
    console.log(`   Member ID: ${user.memberId || 'N/A'}`);
    console.log(`   Name: ${user.firstName || ''} ${user.lastName || ''}`.trim() || 'N/A');
    console.log(`   Email: ${user.email || 'N/A'}`);
    console.log(`   Phone: ${user.phone || 'N/A'}`);
    console.log(`   User Type: ${user.userType || 'N/A'}`);
    console.log(`   Status: ${user.status || 'N/A'}`);
    console.log(`   Company: ${user.company?.companyName || 'N/A'} (${user.company?._id || 'N/A'})`);
    
    // Check if user status is active
    if (user.status !== 'active') {
      console.log(`   ❌ ISSUE: User status is "${user.status || 'N/A'}" but must be "active" for authorization`);
    } else {
      console.log(`   ✅ User status is active`);
    }
    console.log('');
    
    // Find survey
    console.log('🔍 Checking survey...');
    const survey = await Survey.findById(surveyId).lean();
    
    if (!survey) {
      console.log('❌ Survey not found:', surveyId);
      await mongoose.disconnect();
      return;
    }
    
    console.log('✅ Survey found:');
    console.log(`   Survey Name: ${survey.surveyName || 'N/A'}`);
    console.log(`   Survey Mode: ${survey.mode || 'N/A'}`);
    console.log(`   Survey Status: ${survey.status || 'N/A'}`);
    console.log(`   Survey Company: ${survey.company || 'N/A'}`);
    console.log('');
    
    // Check if user's company matches survey's company
    const userCompanyId = user.company?._id?.toString() || user.company?.toString();
    const surveyCompanyId = survey.company?.toString();
    
    console.log('🔍 Checking company match...');
    console.log(`   User Company ID: ${userCompanyId || 'N/A'}`);
    console.log(`   Survey Company ID: ${surveyCompanyId || 'N/A'}`);
    
    if (userCompanyId && surveyCompanyId && userCompanyId !== surveyCompanyId) {
      console.log('   ⚠️  Company mismatch! User and Survey belong to different companies.');
    } else {
      console.log('   ✅ Companies match (or no company restriction)');
    }
    console.log('');
    
    // Check survey assignments
    console.log('🔍 Checking survey assignments...');
    
    // Check assignedInterviewers
    if (survey.assignedInterviewers && Array.isArray(survey.assignedInterviewers)) {
      const assignedInterviewer = survey.assignedInterviewers.find(
        ai => ai.interviewer?.toString() === user._id.toString()
      );
      
      if (assignedInterviewer) {
        console.log('   ✅ User found in assignedInterviewers');
        console.log(`      Assigned At: ${assignedInterviewer.assignedAt || 'N/A'}`);
        console.log(`      Assigned By: ${assignedInterviewer.assignedBy || 'N/A'}`);
      } else {
        console.log('   ❌ User NOT found in assignedInterviewers');
        console.log(`      Total assigned interviewers: ${survey.assignedInterviewers.length}`);
      }
    } else {
      console.log('   ⚠️  No assignedInterviewers array found in survey');
    }
    console.log('');
    
    // Check CAPI interviewers
    if (survey.capiInterviewers && Array.isArray(survey.capiInterviewers)) {
      const capiInterviewer = survey.capiInterviewers.find(
        ci => ci.interviewer?.toString() === user._id.toString()
      );
      
      if (capiInterviewer) {
        console.log('   ✅ User found in capiInterviewers');
      } else {
        console.log('   ❌ User NOT found in capiInterviewers');
        console.log(`      Total CAPI interviewers: ${survey.capiInterviewers.length}`);
      }
    } else {
      console.log('   ⚠️  No capiInterviewers array found in survey');
    }
    console.log('');
    
    // Check CATI interviewers
    if (survey.catiInterviewers && Array.isArray(survey.catiInterviewers)) {
      const catiInterviewer = survey.catiInterviewers.find(
        ci => ci.interviewer?.toString() === user._id.toString()
      );
      
      if (catiInterviewer) {
        console.log('   ✅ User found in catiInterviewers');
        console.log(`      Assigned ACs: ${catiInterviewer.assignedACs?.join(', ') || 'None'}`);
        console.log(`      Status: ${catiInterviewer.status || 'N/A'}`);
        console.log(`      Assigned At: ${catiInterviewer.assignedAt || 'N/A'}`);
        console.log(`      Assigned By: ${catiInterviewer.assignedBy || 'N/A'}`);
        
        // Check if status is valid for authorization
        const validStatuses = ['assigned', 'accepted'];
        if (catiInterviewer.status && validStatuses.includes(catiInterviewer.status)) {
          console.log(`      ✅ Status is valid for authorization (${catiInterviewer.status})`);
        } else {
          console.log(`      ❌ ISSUE: Status "${catiInterviewer.status || 'N/A'}" is NOT valid for authorization`);
          console.log(`         Valid statuses are: ${validStatuses.join(', ')}`);
        }
      } else {
        console.log('   ❌ User NOT found in catiInterviewers');
        console.log(`      Total CATI interviewers: ${survey.catiInterviewers.length}`);
      }
    } else {
      console.log('   ⚠️  No catiInterviewers array found in survey');
    }
    console.log('');
    
    // Check user type and permissions
    console.log('🔍 Checking user type and permissions...');
    console.log(`   User Type: ${user.userType || 'N/A'}`);
    
    const allowedUserTypes = ['interviewer', 'cati_interviewer', 'capi_interviewer', 'project_manager', 'company_admin', 'super_admin'];
    if (user.userType && allowedUserTypes.includes(user.userType)) {
      console.log('   ✅ User type is allowed for interviews');
    } else {
      console.log('   ⚠️  User type might not be allowed for interviews');
    }
    console.log('');
    
    // Summary
    console.log('='.repeat(80));
    console.log('SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(80));
    
    const isAssigned = 
      (survey.assignedInterviewers?.some(ai => ai.interviewer?.toString() === user._id.toString())) ||
      (survey.capiInterviewers?.some(ci => ci.interviewer?.toString() === user._id.toString())) ||
      (survey.catiInterviewers?.some(ci => ci.interviewer?.toString() === user._id.toString()));
    
    if (!isAssigned) {
      console.log('❌ ISSUE FOUND: User is NOT assigned to this survey');
      console.log('   Solution: Assign user to the survey using one of:');
      console.log('   - assignedInterviewers');
      console.log('   - capiInterviewers (for CAPI mode)');
      console.log('   - catiInterviewers (for CATI mode)');
    } else {
      console.log('✅ User IS assigned to the survey');
      console.log('   The issue might be:');
      console.log('   - Route authorization middleware');
      console.log('   - Company mismatch');
      console.log('   - User type restrictions');
      console.log('   - Survey status restrictions');
    }
    
    console.log('');
    
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

checkUserAuthorization();

