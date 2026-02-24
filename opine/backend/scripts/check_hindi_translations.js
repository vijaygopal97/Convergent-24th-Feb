#!/usr/bin/env node

/**
 * Check Hindi Translations in Survey Questions
 * 
 * This script analyzes the survey and identifies questions that are missing
 * Hindi translations or have incomplete Hindi translations in:
 * - Question text
 * - Description
 * - Options
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const Survey = require('../models/Survey');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SURVEY_ID = '68fd1915d41841da463f0d46';

/**
 * Parse translation format to check if Hindi exists
 * Format: "English {Bengali{Hindi}}"
 * Returns: { hasEnglish: boolean, hasBengali: boolean, hasHindi: boolean, languages: string[] }
 */
function parseTranslation(text) {
  if (!text || typeof text !== 'string') {
    return { hasEnglish: false, hasBengali: false, hasHindi: false, languages: [] };
  }
  
  const languages = [];
  let remaining = text.trim();
  
  // Extract languages from nested braces
  while (remaining.length > 0) {
    const openBraceIndex = remaining.indexOf('{');
    
    if (openBraceIndex === -1) {
      // No more braces, add remaining text as a language
      if (remaining.trim()) {
        languages.push(remaining.trim());
      }
      break;
    }
    
    // Extract text before the brace as a language
    const beforeBrace = remaining.substring(0, openBraceIndex).trim();
    if (beforeBrace) {
      languages.push(beforeBrace);
    }
    
    // Find matching closing brace (handle nested braces)
    let braceCount = 0;
    let closeBraceIndex = -1;
    
    for (let i = openBraceIndex; i < remaining.length; i++) {
      if (remaining[i] === '{') {
        braceCount++;
      } else if (remaining[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          closeBraceIndex = i;
          break;
        }
      }
    }
    
    if (closeBraceIndex === -1) {
      // No matching closing brace, treat rest as text
      const restText = remaining.substring(openBraceIndex + 1).trim();
      if (restText) {
        languages.push(restText);
      }
      break;
    }
    
    // Extract content inside braces (may contain nested translations)
    const insideBraces = remaining.substring(openBraceIndex + 1, closeBraceIndex);
    
    // Recursively parse nested translations
    const nestedLanguages = parseTranslation(insideBraces);
    if (nestedLanguages.languages && nestedLanguages.languages.length > 0) {
      languages.push(...nestedLanguages.languages);
    }
    
    // Continue with text after closing brace
    remaining = remaining.substring(closeBraceIndex + 1).trim();
  }
  
  // Determine which languages are present
  const hasEnglish = languages.length > 0;
  const hasBengali = languages.length > 1;
  const hasHindi = languages.length > 2;
  
  return { hasEnglish, hasBengali, hasHindi, languages };
}

/**
 * Check if text has Hindi translation
 */
function hasHindiTranslation(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const parsed = parseTranslation(text);
  return parsed.hasHindi;
}

/**
 * Check if text has Bengali but missing Hindi
 */
function missingHindiTranslation(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  const parsed = parseTranslation(text);
  // Has Bengali but no Hindi
  return parsed.hasBengali && !parsed.hasHindi;
}

async function checkHindiTranslations() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    console.log('='.repeat(80));
    console.log('CHECKING HINDI TRANSLATIONS IN SURVEY QUESTIONS');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}\n`);
    
    // Fetch survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      console.log('❌ Survey not found');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`✅ Survey found: ${survey.surveyName}\n`);
    
    if (!survey.sections || !Array.isArray(survey.sections)) {
      console.log('❌ Survey has no sections');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`📊 Total sections: ${survey.sections.length}\n`);
    
    const issues = [];
    let totalQuestions = 0;
    let questionsWithHindi = 0;
    let questionsMissingHindi = 0;
    
    // Check each section
    survey.sections.forEach((section, sectionIndex) => {
      if (!section.questions || !Array.isArray(section.questions)) {
        return;
      }
      
      section.questions.forEach((question, questionIndex) => {
        totalQuestions++;
        const questionNumber = question.questionNumber || question.order || `Q${questionIndex + 1}`;
        const questionId = question.id || `section${sectionIndex}_q${questionIndex}`;
        
        const questionIssues = [];
        
        // Check question text
        if (question.text) {
          if (missingHindiTranslation(question.text)) {
            questionIssues.push({
              type: 'question_text',
              field: 'text',
              current: question.text.substring(0, 100) + (question.text.length > 100 ? '...' : ''),
              issue: 'Has Bengali but missing Hindi'
            });
          } else if (!hasHindiTranslation(question.text) && question.text.includes('{')) {
            // Has some translation but not Hindi
            const parsed = parseTranslation(question.text);
            if (parsed.hasBengali) {
              questionIssues.push({
                type: 'question_text',
                field: 'text',
                current: question.text.substring(0, 100) + (question.text.length > 100 ? '...' : ''),
                issue: 'Has Bengali but missing Hindi'
              });
            }
          }
        }
        
        // Check description
        if (question.description) {
          if (missingHindiTranslation(question.description)) {
            questionIssues.push({
              type: 'description',
              field: 'description',
              current: question.description.substring(0, 100) + (question.description.length > 100 ? '...' : ''),
              issue: 'Has Bengali but missing Hindi'
            });
          }
        }
        
        // Check options
        if (question.options && Array.isArray(question.options)) {
          question.options.forEach((option, optIndex) => {
            if (option.text) {
              if (missingHindiTranslation(option.text)) {
                questionIssues.push({
                  type: 'option',
                  field: `options[${optIndex}].text`,
                  current: option.text.substring(0, 80) + (option.text.length > 80 ? '...' : ''),
                  issue: 'Has Bengali but missing Hindi'
                });
              }
            }
          });
        }
        
        // If there are issues, add to list
        if (questionIssues.length > 0) {
          questionsMissingHindi++;
          issues.push({
            sectionIndex: sectionIndex + 1,
            sectionTitle: section.sectionTitle || `Section ${sectionIndex + 1}`,
            questionNumber: questionNumber,
            questionId: questionId,
            questionText: question.text ? question.text.substring(0, 150) : 'N/A',
            issues: questionIssues
          });
        } else {
          // Check if question has any translations at all
          const hasAnyTranslation = 
            (question.text && question.text.includes('{')) ||
            (question.description && question.description.includes('{')) ||
            (question.options && question.options.some(opt => opt.text && opt.text.includes('{')));
          
          if (hasAnyTranslation) {
            questionsWithHindi++;
          }
        }
      });
    });
    
    // Display results
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total questions checked: ${totalQuestions}`);
    console.log(`Questions with Hindi translations: ${questionsWithHindi}`);
    console.log(`Questions missing/incomplete Hindi translations: ${questionsMissingHindi}\n`);
    
    if (issues.length > 0) {
      console.log('='.repeat(80));
      console.log('QUESTIONS MISSING/INCOMPLETE HINDI TRANSLATIONS');
      console.log('='.repeat(80));
      console.log('');
      
      issues.forEach((issue, index) => {
        console.log(`${index + 1}. Section ${issue.sectionIndex}: ${issue.sectionTitle}`);
        console.log(`   Question: ${issue.questionNumber} (ID: ${issue.questionId})`);
        console.log(`   Text: ${issue.questionText}`);
        console.log(`   Issues found: ${issue.issues.length}`);
        
        issue.issues.forEach((item, itemIndex) => {
          console.log(`      ${itemIndex + 1}. ${item.type.toUpperCase()} - ${item.field}`);
          console.log(`         Issue: ${item.issue}`);
          console.log(`         Current: ${item.current}`);
        });
        console.log('');
      });
      
      // Generate CSV report
      const reportsDir = path.join(__dirname, '../scripts/reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const csvPath = path.join(reportsDir, `missing_hindi_translations_${timestamp}.csv`);
      
      const csvRows = [
        ['Section Index', 'Section Title', 'Question Number', 'Question ID', 'Field Type', 'Field Path', 'Issue', 'Current Text'].join(',')
      ];
      
      issues.forEach(issue => {
        issue.issues.forEach(item => {
          const row = [
            issue.sectionIndex,
            `"${(issue.sectionTitle || '').replace(/"/g, '""')}"`,
            issue.questionNumber,
            issue.questionId,
            item.type,
            item.field,
            `"${item.issue.replace(/"/g, '""')}"`,
            `"${item.current.replace(/"/g, '""')}"`
          ].join(',');
          csvRows.push(row);
        });
      });
      
      fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
      console.log(`💾 CSV report saved to: ${csvPath}\n`);
    } else {
      console.log('✅ All questions have complete Hindi translations!\n');
    }
    
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

checkHindiTranslations();























