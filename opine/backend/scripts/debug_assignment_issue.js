require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const User = require('../models/User');

const INTERVIEWER_ID = '697306df4e30e6669e4929c5';
const SURVEY_ID = '68fd1915d41841da463f0d46';

async function debugAssignment() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Get interviewer
    const interviewer = await User.findById(INTERVIEWER_ID).lean();
    console.log('👤 Interviewer:');
    console.log(`  _id: ${interviewer._id}`);
    console.log(`  _id type: ${typeof interviewer._id}`);
    console.log(`  _id toString(): ${interviewer._id.toString()}`);
    console.log(`  memberId: ${interviewer.memberId}\n`);

    // Get survey WITHOUT lean() first
    console.log('📋 Survey WITHOUT lean():');
    const surveyWithoutLean = await Survey.findById(SURVEY_ID)
      .select('catiInterviewers')
      .limit(1);
    
    if (surveyWithoutLean && surveyWithoutLean.catiInterviewers.length > 0) {
      const assignment = surveyWithoutLean.catiInterviewers[0];
      console.log(`  First assignment interviewer type: ${typeof assignment.interviewer}`);
      console.log(`  First assignment interviewer: ${assignment.interviewer}`);
      console.log(`  First assignment interviewer toString(): ${assignment.interviewer.toString()}`);
      console.log(`  Is ObjectId: ${assignment.interviewer instanceof mongoose.Types.ObjectId}`);
      console.log(`  Constructor: ${assignment.interviewer.constructor.name}\n`);
    }

    // Get survey WITH lean()
    console.log('📋 Survey WITH lean():');
    const surveyWithLean = await Survey.findById(SURVEY_ID)
      .select('catiInterviewers')
      .lean();
    
    if (surveyWithLean && surveyWithLean.catiInterviewers.length > 0) {
      const assignment = surveyWithLean.catiInterviewers[0];
      console.log(`  First assignment interviewer type: ${typeof assignment.interviewer}`);
      console.log(`  First assignment interviewer: ${assignment.interviewer}`);
      console.log(`  First assignment interviewer toString(): ${assignment.interviewer?.toString ? assignment.interviewer.toString() : 'NO toString method'}`);
      console.log(`  Is ObjectId: ${assignment.interviewer instanceof mongoose.Types.ObjectId}`);
      console.log(`  Constructor: ${assignment.interviewer?.constructor?.name || 'N/A'}\n`);
    }

    // Find the specific assignment
    console.log('🔍 Finding assignment for interviewer:', INTERVIEWER_ID);
    const survey = await Survey.findById(SURVEY_ID)
      .select('catiInterviewers')
      .lean();
    
    const targetAssignment = survey.catiInterviewers.find(a => {
      const aId = a.interviewer?.toString ? a.interviewer.toString() : String(a.interviewer);
      return aId === INTERVIEWER_ID;
    });

    if (targetAssignment) {
      console.log('✅ Found assignment!');
      console.log(`  Assignment interviewer: ${targetAssignment.interviewer}`);
      console.log(`  Assignment interviewer type: ${typeof targetAssignment.interviewer}`);
      console.log(`  Assignment status: ${targetAssignment.status}`);
    } else {
      console.log('❌ Assignment NOT found!');
      console.log('\n🔍 Checking all assignments:');
      survey.catiInterviewers.forEach((a, idx) => {
        const aId = a.interviewer?.toString ? a.interviewer.toString() : String(a.interviewer);
        const match = aId === INTERVIEWER_ID;
        console.log(`  ${idx + 1}. interviewer: ${aId}, type: ${typeof a.interviewer}, match: ${match}, status: ${a.status}`);
      });
    }

    // Test the exact comparison logic from the code
    console.log('\n🧪 Testing comparison logic:');
    const interviewerId = mongoose.Types.ObjectId(INTERVIEWER_ID);
    survey.catiInterviewers.forEach((a, idx) => {
      if (!a || !a.interviewer) return;
      
      const assignmentInterviewerId = a.interviewer.toString ? a.interviewer.toString() : String(a.interviewer);
      const currentInterviewerId = interviewerId.toString ? interviewerId.toString() : String(interviewerId);
      
      const idMatch = assignmentInterviewerId === currentInterviewerId;
      const statusMatch = a.status === 'assigned' || a.status === 'accepted';
      
      if (idx < 5) { // Show first 5
        console.log(`  Assignment ${idx + 1}:`);
        console.log(`    assignmentInterviewerId: "${assignmentInterviewerId}" (type: ${typeof assignmentInterviewerId})`);
        console.log(`    currentInterviewerId: "${currentInterviewerId}" (type: ${typeof currentInterviewerId})`);
        console.log(`    idMatch: ${idMatch}`);
        console.log(`    statusMatch: ${statusMatch}`);
        console.log(`    Final match: ${idMatch && statusMatch}`);
      }
    });

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
  }
}

debugAssignment();
































