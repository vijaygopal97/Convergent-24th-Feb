#!/usr/bin/env node

/**
 * Revert Hindi Translations from Survey Questions
 * 
 * This script reverts Hindi translations that were added by add_hindi_translations.js
 * It uses the revert report JSON file to restore the original values.
 * 
 * Usage: node revert_hindi_translations.js <revert_report_path>
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function revertHindiTranslations(revertReportPath) {
  try {
    if (!revertReportPath) {
      console.error('❌ Error: Revert report path is required');
      console.error('\nUsage: node revert_hindi_translations.js <revert_report_path>');
      process.exit(1);
    }
    
    // Check if file exists
    if (!fs.existsSync(revertReportPath)) {
      console.error(`❌ Error: Revert report file not found: ${revertReportPath}`);
      process.exit(1);
    }
    
    // Read revert report
    const revertReport = JSON.parse(fs.readFileSync(revertReportPath, 'utf8'));
    
    console.log('='.repeat(80));
    console.log('REVERTING HINDI TRANSLATIONS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${revertReport.surveyId}`);
    console.log(`Survey Name: ${revertReport.surveyName}`);
    console.log(`Original Timestamp: ${revertReport.timestamp}`);
    console.log(`Total Changes to Revert: ${revertReport.changes.length}\n`);
    
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Fetch survey
    const survey = await Survey.findById(revertReport.surveyId);
    if (!survey) {
      console.log('❌ Survey not found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`✅ Survey found: ${survey.surveyName}\n`);
    
    let revertedCount = 0;
    let notFoundCount = 0;
    
    // Group changes by question for efficient processing
    const changesByQuestion = {};
    revertReport.changes.forEach(change => {
      const key = `${change.sectionIndex}_${change.questionId}`;
      if (!changesByQuestion[key]) {
        changesByQuestion[key] = [];
      }
      changesByQuestion[key].push(change);
    });
    
    // Process each section
    survey.sections.forEach((section, sectionIndex) => {
      if (!section.questions || !Array.isArray(section.questions)) {
        return;
      }
      
      section.questions.forEach((question, questionIndex) => {
        const questionId = question.id || `section${sectionIndex}_q${questionIndex}`;
        const key = `${sectionIndex + 1}_${questionId}`;
        const questionChanges = changesByQuestion[key];
        
        if (!questionChanges || questionChanges.length === 0) {
          return;
        }
        
        // Apply each change for this question
        questionChanges.forEach(change => {
          if (change.fieldType === 'question_text' && change.fieldPath === 'text') {
            question.text = change.oldValue;
            revertedCount++;
            console.log(`✅ Reverted Q${change.questionNumber} - Question Text`);
          } else if (change.fieldType === 'description' && change.fieldPath === 'description') {
            question.description = change.oldValue;
            revertedCount++;
            console.log(`✅ Reverted Q${change.questionNumber} - Description`);
          } else if (change.fieldType === 'option' && change.fieldPath.startsWith('options[')) {
            const optIndexMatch = change.fieldPath.match(/options\[(\d+)\]/);
            if (optIndexMatch && question.options) {
              const optIndex = parseInt(optIndexMatch[1], 10);
              if (question.options[optIndex]) {
                question.options[optIndex].text = change.oldValue;
                revertedCount++;
                console.log(`✅ Reverted Q${change.questionNumber} - Option ${optIndex + 1}`);
              } else {
                notFoundCount++;
                console.log(`⚠️  Option ${optIndex + 1} not found in Q${change.questionNumber}`);
              }
            } else {
              notFoundCount++;
              console.log(`⚠️  Could not parse option index from: ${change.fieldPath}`);
            }
          } else {
            notFoundCount++;
            console.log(`⚠️  Unknown field type/path: ${change.fieldType} / ${change.fieldPath}`);
          }
        });
      });
    });
    
    // Save survey if changes were made
    if (revertedCount > 0) {
      await survey.save();
      console.log(`\n✅ Survey reverted with ${revertedCount} changes`);
      if (notFoundCount > 0) {
        console.log(`⚠️  ${notFoundCount} changes could not be reverted (field not found)`);
      }
    } else {
      console.log('\n⚠️  No changes were reverted');
    }
    
    // Create revert confirmation report
    const reportsDir = path.join(__dirname, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const confirmationReport = {
      originalReport: revertReportPath,
      revertedAt: timestamp,
      revertedCount: revertedCount,
      notFoundCount: notFoundCount,
      changes: revertReport.changes
    };
    
    const confirmationPath = path.join(reportsDir, `hindi_translations_reverted_${timestamp}.json`);
    fs.writeFileSync(confirmationPath, JSON.stringify(confirmationReport, null, 2), 'utf8');
    
    console.log(`\n📄 Revert confirmation saved to: ${confirmationPath}\n`);
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(1);
  }
}

// Get revert report path from command line arguments
const revertReportPath = process.argv[2];
revertHindiTranslations(revertReportPath);













