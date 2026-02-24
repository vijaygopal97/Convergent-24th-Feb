#!/usr/bin/env node

const mongoose = require('mongoose');
const path = require('path');
const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function checkQuestions() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      console.log('❌ Survey not found');
      await mongoose.disconnect();
      return;
    }
    
    const questionsToCheck = ['14', '16.b', '17', '19', '20', '21', '22', '27'];
    
    questionsToCheck.forEach(qNum => {
      let question = null;
      
      // Search in all sections
      for (const section of survey.sections) {
        if (section.questions) {
          question = section.questions.find(q => q.questionNumber === qNum);
          if (question) break;
        }
      }
      
      if (question) {
        console.log('='.repeat(80));
        console.log(`Question ${qNum}: ${question.text?.substring(0, 80)}...`);
        console.log('='.repeat(80));
        console.log('Text:', question.text);
        console.log('Description:', question.description);
        if (question.options && question.options.length > 0) {
          console.log(`\nFirst 3 Options:`);
          question.options.slice(0, 3).forEach((opt, idx) => {
            console.log(`  ${idx + 1}. ${opt.text}`);
          });
        }
        console.log('');
      } else {
        console.log(`❌ Question ${qNum} not found\n`);
      }
    });
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

checkQuestions();













