#!/usr/bin/env node

const mongoose = require('mongoose');
const path = require('path');
const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function checkSurvey() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const surveyId = '68fd1915d41841da463f0d46';
    const survey = await Survey.findById(surveyId).lean();
    
    if (!survey) {
      console.log('❌ Survey not found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`📋 Survey: ${survey.surveyName}`);
    console.log(`   Mode: ${survey.mode}`);
    console.log(`   Sections: ${survey.sections?.length || 0}\n`);
    
    // Check for consent questions
    console.log('🔍 Searching for consent questions...\n');
    
    let consentFound = false;
    let consentQuestions = [];
    
    if (survey.sections) {
      survey.sections.forEach((section, sIdx) => {
        if (section.questions) {
          section.questions.forEach((question, qIdx) => {
            const questionId = question.id || question._id?.toString();
            const questionText = question.text || '';
            const questionNumber = question.questionNumber || 'N/A';
            const order = question.order !== undefined ? question.order : 'N/A';
            
            // Check if it's a consent question
            if (questionId === 'consent-form' || 
                questionId?.includes('consent') ||
                questionText.toLowerCase().includes('consent') ||
                questionText.toLowerCase().includes('agree')) {
              consentFound = true;
              consentQuestions.push({
                sectionIndex: sIdx,
                sectionTitle: section.title || 'Untitled',
                questionIndex: qIdx,
                questionId: questionId,
                questionNumber: questionNumber,
                order: order,
                text: questionText.substring(0, 100),
                type: question.type,
                isFixed: question.isFixed || false,
                isLocked: question.isLocked || false
              });
            }
          });
        }
      });
    }
    
    if (consentQuestions.length > 0) {
      console.log(`✅ Found ${consentQuestions.length} consent-related question(s):\n`);
      consentQuestions.forEach((cq, idx) => {
        console.log(`   ${idx + 1}. Question ID: ${cq.questionId}`);
        console.log(`      Section: ${cq.sectionTitle}`);
        console.log(`      Question Number: ${cq.questionNumber}`);
        console.log(`      Order: ${cq.order}`);
        console.log(`      Type: ${cq.type}`);
        console.log(`      Is Fixed: ${cq.isFixed}`);
        console.log(`      Is Locked: ${cq.isLocked}`);
        console.log(`      Text: ${cq.text}...`);
        console.log('');
      });
    } else {
      console.log('⚠️  No consent questions found in survey sections');
      console.log('   Consent questions might be added dynamically in the app\n');
    }
    
    // Check question ordering
    console.log('📊 Question Ordering Analysis:\n');
    console.log('   Questions are stored with:');
    console.log('   - order field (numeric)');
    console.log('   - questionNumber field (string like "1", "2", "1.a", etc.)');
    console.log('');
    console.log('   ⚠️  IMPORTANT: Question ordering is HARDCODED in React Native app');
    console.log('   - File: Opine-Android/src/screens/InterviewInterface.tsx');
    console.log('   - There is a "desiredOrder" array that reorders questions');
    console.log('   - This happens CLIENT-SIDE, not server-side');
    console.log('');
    
    // Show sample questions with their order
    if (survey.sections && survey.sections.length > 0) {
      console.log('📋 Sample Questions (first 10):\n');
      let count = 0;
      survey.sections.forEach((section, sIdx) => {
        if (section.questions && count < 10) {
          section.questions.forEach((question, qIdx) => {
            if (count < 10) {
              const qNum = question.questionNumber || 'N/A';
              const order = question.order !== undefined ? question.order : 'N/A';
              const text = (question.text || '').substring(0, 50);
              console.log(`   ${count + 1}. Q${qNum} (order: ${order}): ${text}...`);
              count++;
            }
          });
        }
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY & RECOMMENDATIONS');
    console.log('='.repeat(80));
    console.log('');
    console.log('1. CONSENT QUESTION:');
    if (consentFound) {
      console.log('   ✅ Consent question exists in database');
      console.log('   ✅ CAN be updated from backend by modifying the question text');
      console.log('   ✅ No app update needed - app reads from API');
    } else {
      console.log('   ⚠️  Consent question might be added dynamically in app');
      console.log('   ⚠️  Check if consent-form is a system question added client-side');
    }
    console.log('');
    console.log('2. QUESTION ORDERING:');
    console.log('   ❌ Question ordering is HARDCODED in React Native app');
    console.log('   ❌ Cannot be changed from backend only');
    console.log('   ❌ Requires app update to change desiredOrder array');
    console.log('   💡 SOLUTION: Move ordering logic to backend API');
    console.log('      - Add a "questionOrder" field to survey model');
    console.log('      - Return questions in correct order from /api/surveys/:id/full');
    console.log('      - Remove hardcoded ordering from React Native app');
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

checkSurvey();























