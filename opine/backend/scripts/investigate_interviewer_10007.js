require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Survey = require('../models/Survey');

const MEMBER_ID = '10007';

async function investigateInterviewer() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('❌ Error: MONGODB_URI not found');
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('='.repeat(60));
    console.log(`Investigating Interviewer: ${MEMBER_ID}`);
    console.log('='.repeat(60) + '\n');

    // 1. Find interviewer by memberId
    const interviewer = await User.findOne({ memberId: MEMBER_ID }).lean();
    
    if (!interviewer) {
      console.log('❌ Interviewer not found with memberId:', MEMBER_ID);
      await mongoose.disconnect();
      return;
    }

    console.log('👤 INTERVIEWER DETAILS:');
    console.log('─'.repeat(60));
    console.log(`ID: ${interviewer._id}`);
    console.log(`Member ID: ${interviewer.memberId}`);
    console.log(`Name: ${interviewer.firstName} ${interviewer.lastName}`);
    console.log(`Email: ${interviewer.email}`);
    console.log(`Phone: ${interviewer.phone}`);
    console.log(`User Type: ${interviewer.userType}`);
    console.log(`Interview Modes: ${interviewer.interviewModes}`);
    console.log(`Status: ${interviewer.status}`);
    console.log(`Is Active: ${interviewer.isActive}`);
    console.log(`Company: ${interviewer.company || 'N/A'}`);
    console.log(`Company Code: ${interviewer.companyCode || 'N/A'}`);

    // 2. Find default survey (usually the main CATI survey)
    const defaultSurveyId = '68fd1915d41841da463f0d46';
    const survey = await Survey.findById(defaultSurveyId)
      .select('surveyName status catiInterviewers assignACs acAssignmentState')
      .lean();

    if (!survey) {
      console.log('\n❌ Default survey not found');
      await mongoose.disconnect();
      return;
    }

    console.log('\n📋 DEFAULT SURVEY DETAILS:');
    console.log('─'.repeat(60));
    console.log(`Survey ID: ${survey._id}`);
    console.log(`Survey Name: ${survey.surveyName}`);
    console.log(`Status: ${survey.status}`);
    console.log(`Assign ACs: ${survey.assignACs ? 'Yes' : 'No'}`);
    console.log(`AC Assignment State: ${survey.acAssignmentState || 'N/A'}`);

    // 3. Check CATI interviewer assignment
    console.log('\n🔍 CATI INTERVIEWER ASSIGNMENT:');
    console.log('─'.repeat(60));
    
    const assignment = survey.catiInterviewers?.find(a => {
      const assignmentInterviewerId = a.interviewer?.toString ? a.interviewer.toString() : String(a.interviewer);
      const interviewerId = interviewer._id.toString();
      return assignmentInterviewerId === interviewerId;
    });

    if (!assignment) {
      console.log('❌ NOT ASSIGNED to this survey');
      console.log(`\nTotal CATI interviewers in survey: ${survey.catiInterviewers?.length || 0}`);
    } else {
      console.log('✅ ASSIGNED to this survey');
      console.log(`Assignment Status: ${assignment.status}`);
      console.log(`Assigned ACs Count: ${assignment.assignedACs?.length || 0}`);
      
      if (assignment.assignedACs && assignment.assignedACs.length > 0) {
        console.log('\n📌 ASSIGNED ACs:');
        assignment.assignedACs.forEach((ac, index) => {
          console.log(`  ${index + 1}. ${ac.code || ac} - ${ac.name || 'N/A'}`);
        });
      } else {
        console.log('\n⚠️ NO ACs ASSIGNED');
      }
    }

    // 4. Check all surveys this interviewer is assigned to
    console.log('\n\n📊 ALL SURVEY ASSIGNMENTS:');
    console.log('─'.repeat(60));
    
    const allSurveys = await Survey.find({
      'catiInterviewers.interviewer': interviewer._id
    })
    .select('surveyName status catiInterviewers assignACs')
    .lean();

    if (allSurveys.length === 0) {
      console.log('❌ Not assigned to any surveys');
    } else {
      allSurveys.forEach((s, index) => {
        const ass = s.catiInterviewers?.find(a => {
          const aId = a.interviewer?.toString ? a.interviewer.toString() : String(a.interviewer);
          return aId === interviewer._id.toString();
        });
        console.log(`\n${index + 1}. Survey: ${s.surveyName}`);
        console.log(`   Survey ID: ${s._id}`);
        console.log(`   Status: ${s.status}`);
        console.log(`   Assignment Status: ${ass?.status || 'N/A'}`);
        console.log(`   Assigned ACs: ${ass?.assignedACs?.length || 0}`);
      });
    }

    // 5. Potential issues summary
    console.log('\n\n🔍 POTENTIAL ISSUES ANALYSIS:');
    console.log('='.repeat(60));
    
    const issues = [];
    
    if (interviewer.status !== 'active') {
      issues.push(`❌ User status is "${interviewer.status}" (should be "active")`);
    }
    
    if (!interviewer.isActive) {
      issues.push(`❌ User isActive is false`);
    }
    
    if (interviewer.userType !== 'interviewer') {
      issues.push(`❌ User type is "${interviewer.userType}" (should be "interviewer")`);
    }
    
    if (interviewer.interviewModes !== 'CATI (Telephonic interview)' && interviewer.interviewModes !== 'Both') {
      issues.push(`❌ Interview modes is "${interviewer.interviewModes}" (should include CATI)`);
    }
    
    if (!assignment) {
      issues.push(`❌ Not assigned to default survey (${defaultSurveyId})`);
    } else if (assignment.status !== 'assigned' && assignment.status !== 'accepted') {
      issues.push(`❌ Assignment status is "${assignment.status}" (should be "assigned" or "accepted")`);
    }
    
    if (survey.status !== 'active') {
      issues.push(`❌ Survey status is "${survey.status}" (should be "active")`);
    }
    
    if (issues.length === 0) {
      console.log('✅ No obvious issues found');
      console.log('\n💡 Possible causes for intermittent errors:');
      console.log('   1. Token expiration during session');
      console.log('   2. Race condition in assignment check');
      console.log('   3. Database connection timeout');
      console.log('   4. Cache inconsistency (though code bypasses cache)');
    } else {
      issues.forEach(issue => console.log(issue));
    }

    console.log('\n✅ Investigation complete\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

investigateInterviewer();
































