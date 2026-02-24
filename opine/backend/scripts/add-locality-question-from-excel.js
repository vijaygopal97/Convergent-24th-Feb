/**
 * Add Locality Type Question to Existing Responses from Excel
 * 
 * This script adds question_1767953047865_319 (Locality Type) to responses
 * that don't have it, based on the Excel file data.
 * 
 * IMPORTANT: 
 * - Only processes Approved, Rejected, or Pending Approval responses
 * - Skips abandoned and terminated responses
 * - Only adds question if it doesn't already exist
 * - Generates a detailed report for reversal if needed
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config();

const QUESTION_ID = 'question_1767953047865_319';
const SURVEY_ID = '68fd1915d41841da463f0d46';
const EXCEL_PATH = '/var/www/reports/11WB_Vijay_Locality_Blank_Response_id 1 (1).xlsx';

// Valid statuses to process
const VALID_STATUSES = ['Approved', 'Rejected', 'Pending_Approval'];

// Report file paths
const REPORT_DIR = path.join(__dirname, '../../reports');
const REPORT_FILE = path.join(REPORT_DIR, `locality-question-update-report-${Date.now()}.json`);
const REVERSAL_SCRIPT = path.join(REPORT_DIR, `reverse-locality-question-update-${Date.now()}.js`);

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

async function main() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB');

    const SurveyResponse = require('../models/SurveyResponse');
    const Survey = require('../models/Survey');

    // Get survey and question details
    console.log('\n📋 Fetching survey and question details...');
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }

    // Find question in survey
    let question = null;
    let sectionIndex = null;
    let questionIndex = null;

    // Search in sections
    if (survey.sections && Array.isArray(survey.sections)) {
      for (let sIdx = 0; sIdx < survey.sections.length; sIdx++) {
        const section = survey.sections[sIdx];
        if (section.questions && Array.isArray(section.questions)) {
          for (let qIdx = 0; qIdx < section.questions.length; qIdx++) {
            if (section.questions[qIdx].id === QUESTION_ID) {
              question = section.questions[qIdx];
              sectionIndex = sIdx;
              questionIndex = qIdx;
              break;
            }
          }
        }
        if (question) break;
      }
    }

    // If not found in sections, search in direct questions
    if (!question && survey.questions && Array.isArray(survey.questions)) {
      for (let qIdx = 0; qIdx < survey.questions.length; qIdx++) {
        if (survey.questions[qIdx].id === QUESTION_ID) {
          question = survey.questions[qIdx];
          sectionIndex = -1; // -1 indicates direct question (not in section)
          questionIndex = qIdx;
          break;
        }
      }
    }

    if (!question) {
      throw new Error(`Question ${QUESTION_ID} not found in survey`);
    }

    console.log('✅ Question found:', question.text);
    console.log(`   Section Index: ${sectionIndex}, Question Index: ${questionIndex}`);

    // Read Excel file
    console.log('\n📖 Reading Excel file...');
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`✅ Loaded ${data.length} rows from Excel`);

    // Statistics
    const stats = {
      total: 0,
      alreadyHasQuestion: 0,
      updated: 0,
      skipped: 0,
      notFoundInDB: 0,
      wrongStatus: 0,
      errors: 0,
      breakdown: {
        urban: 0,
        rural: 0,
        notFound: 0,
        unknown: 0
      }
    };

    // Report data for reversal
    const report = {
      timestamp: new Date().toISOString(),
      questionId: QUESTION_ID,
      surveyId: SURVEY_ID,
      questionDetails: {
        id: question.id,
        text: question.text,
        type: question.type,
        options: question.options
      },
      changes: [],
      statistics: stats
    };

    // Process Excel rows
    console.log('\n🔄 Processing responses...');
    const startTime = Date.now();

    // Build a map of responseId -> locality type for faster lookup
    const localityMap = new Map();
    for (const row of data) {
      const responseId = row['Response ID']?.toString().trim();
      const localityType = row['Q29'];
      
      if (responseId && localityType !== undefined && localityType !== null) {
        // Handle NaN values (Excel NaN becomes null in JSON)
        if (localityType !== '' && String(localityType).toLowerCase() !== 'nan') {
          localityMap.set(responseId, String(localityType).trim());
        }
      }
    }

    console.log(`✅ Built locality map with ${localityMap.size} entries`);

    // Process in batches for efficiency
    const batchSize = 1000;
    const responseIds = Array.from(localityMap.keys());
    let processed = 0;

    for (let i = 0; i < responseIds.length; i += batchSize) {
      const batch = responseIds.slice(i, i + batchSize);
      
      // Fetch responses in batch
      const responses = await SurveyResponse.find({
        responseId: { $in: batch },
        survey: SURVEY_ID,
        status: { $in: VALID_STATUSES }
      })
        .select('_id responseId status responses')
        .lean();

      // Create a map for quick lookup
      const responseMap = new Map();
      for (const resp of responses) {
        responseMap.set(resp.responseId, resp);
      }

      // Process each response in batch
      for (const responseId of batch) {
        stats.total++;
        processed++;

        if (processed % 1000 === 0) {
          console.log(`   Processed ${processed}/${responseIds.length}... (${stats.updated} updated, ${stats.skipped} skipped)`);
        }

        try {
          const response = responseMap.get(responseId);
          
          if (!response) {
            stats.notFoundInDB++;
            continue;
          }

          // Check status (double check)
          if (!VALID_STATUSES.includes(response.status)) {
            stats.wrongStatus++;
            continue;
          }

          // Check if question already exists
          const hasQuestion = response.responses?.some(r => r.questionId === QUESTION_ID);
          if (hasQuestion) {
            stats.alreadyHasQuestion++;
            continue;
          }

          // Get locality type from map
          const localityType = localityMap.get(responseId);
          if (!localityType) {
            stats.breakdown.notFound++;
            stats.skipped++;
            continue;
          }

          // Determine what to do based on locality type
          const locType = localityType.trim();
          let shouldUpdate = false;
          let responseValue = null;
          let responseCode = null;
          let updateReason = null;

          // Handle "Not Sure" - ignore the "Not sure" part and use whatever is there
          // e.g., "Rural (Not sure)" -> "Rural"
          const cleanLocType = locType.replace(/\s*\([^)]*not\s+sure[^)]*\)/i, '').trim();

          if (cleanLocType === 'Urban' || locType === 'Urban') {
            shouldUpdate = true;
            responseValue = question.options[0].value; // urban value
            responseCode = question.options[0].code; // "1"
            updateReason = 'Urban';
            stats.breakdown.urban++;
          } else if (cleanLocType === 'Rural' || locType === 'Rural' || locType.includes('Rural')) {
            shouldUpdate = true;
            responseValue = question.options[1].value; // rural value
            responseCode = question.options[1].code; // "2"
            updateReason = locType.includes('Not sure') ? 'Rural (Not sure) → Rural' : 'Rural';
            stats.breakdown.rural++;
          } else if (locType === 'Not Found' || locType === '' || locType.toLowerCase() === 'nan') {
            shouldUpdate = false;
            updateReason = 'Not Found - Skipped';
            stats.breakdown.notFound++;
          } else {
            shouldUpdate = false;
            updateReason = `Unknown type: "${locType}" - Skipped`;
            stats.breakdown.unknown++;
          }

          if (!shouldUpdate) {
            stats.skipped++;
            continue;
          }

          // Create response object to add
          const questionOptions = question.options.map(opt => opt.text);
          const selectedOption = question.options.find(opt => opt.code === responseCode);
          
          const newResponseObject = {
            sectionIndex: sectionIndex,
            questionIndex: questionIndex,
            questionId: question.id,
            questionType: question.type,
            questionText: question.text,
            questionDescription: question.description || '',
            questionOptions: questionOptions,
            response: responseValue,
            responseCodes: responseCode,
            responseWithCodes: {
              code: responseCode,
              answer: responseValue,
              optionText: selectedOption ? selectedOption.text : ''
            },
            responseTime: 0, // No response time for retroactively added responses
            isRequired: question.required || false,
            isSkipped: false
          };

          // Store original state for reversal
          const originalResponsesCount = response.responses?.length || 0;
          const originalResponseIds = response.responses?.map(r => r.questionId) || [];

          // Update the response using bulkWrite for efficiency
          const updateResult = await SurveyResponse.updateOne(
            { _id: response._id },
            { 
              $push: { responses: newResponseObject },
              $set: { updatedAt: new Date() }
            }
          );

          if (updateResult.modifiedCount === 1) {
            stats.updated++;

            // Add to report for reversal
            report.changes.push({
              responseId: responseId,
              timestamp: new Date().toISOString(),
              updateReason: updateReason,
              addedResponse: {
                questionId: newResponseObject.questionId,
                response: newResponseObject.response,
                responseCodes: newResponseObject.responseCodes,
                sectionIndex: newResponseObject.sectionIndex,
                questionIndex: newResponseObject.questionIndex
              },
              originalState: {
                responsesCount: originalResponsesCount,
                questionIds: originalResponseIds
              },
              newState: {
                responsesCount: originalResponsesCount + 1,
                questionIds: [...originalResponseIds, QUESTION_ID]
              }
            });
          } else {
            stats.errors++;
            console.error(`   ⚠️ Failed to update response ${responseId}`);
          }

        } catch (err) {
          stats.errors++;
          console.error(`   ❌ Error processing ${responseId}:`, err.message);
          if (stats.errors <= 10) {
            console.error('   Stack:', err.stack);
          }
        }
      }
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Update final statistics
    report.statistics = stats;
    report.duration = `${duration} seconds`;
    report.completedAt = new Date().toISOString();

    // Save report
    console.log('\n💾 Saving report...');
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
    console.log(`✅ Report saved to: ${REPORT_FILE}`);

    // Generate reversal script
    console.log('\n📝 Generating reversal script...');
    const reversalScript = generateReversalScript(report, REVERSAL_SCRIPT);
    fs.writeFileSync(REVERSAL_SCRIPT, reversalScript);
    console.log(`✅ Reversal script saved to: ${REVERSAL_SCRIPT}`);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 UPDATE SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total responses in Excel: ${data.length}`);
    console.log(`Total responses processed: ${stats.total}`);
    console.log(`Already had question: ${stats.alreadyHasQuestion}`);
    console.log(`✅ Successfully updated: ${stats.updated}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    console.log(`   - Not Found in Excel: ${stats.breakdown.notFound}`);
    console.log(`   - Unknown types: ${stats.breakdown.unknown}`);
    console.log(`❌ Errors: ${stats.errors}`);
    console.log(`📦 Not found in DB: ${stats.notFoundInDB}`);
    console.log(`🚫 Wrong status (abandoned/terminated): ${stats.wrongStatus}`);
    console.log('\n📈 Breakdown of updates:');
    console.log(`   - Urban: ${stats.breakdown.urban}`);
    console.log(`   - Rural: ${stats.breakdown.rural}`);
    console.log(`\n⏱️  Duration: ${duration} seconds`);
    console.log(`\n📄 Report: ${REPORT_FILE}`);
    console.log(`🔄 Reversal script: ${REVERSAL_SCRIPT}`);
    console.log('='.repeat(60));

    await mongoose.disconnect();
    console.log('\n✅ Process completed successfully!');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error('Stack:', error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

function generateReversalScript(report, scriptPath) {
  const scriptName = path.basename(scriptPath);
  
  return `/**
 * Reversal Script: Remove Locality Type Question from Responses
 * 
 * This script reverses the changes made by add-locality-question-from-excel.js
 * 
 * Generated: ${report.timestamp}
 * Report: ${path.basename(REPORT_FILE)}
 * 
 * Usage: node ${scriptName}
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const QUESTION_ID = '${report.questionId}';
const REPORT_FILE = path.join(__dirname, '${path.basename(REPORT_FILE)}');

async function reverse() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB');

    const SurveyResponse = require('../../backend/models/SurveyResponse');

    // Load report
    console.log('\\n📖 Loading report...');
    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf-8'));
    console.log(\`✅ Loaded report with \${report.changes.length} changes\`);

    const stats = {
      total: report.changes.length,
      removed: 0,
      notFound: 0,
      alreadyRemoved: 0,
      errors: 0
    };

    console.log('\\n🔄 Reversing changes...');

    // Process in batches
    const batchSize = 1000;
    for (let i = 0; i < report.changes.length; i += batchSize) {
      const batch = report.changes.slice(i, i + batchSize);
      
      for (const change of batch) {
        if ((stats.removed + stats.alreadyRemoved + stats.notFound + stats.errors) % 1000 === 0) {
          console.log(\`   Processed \${stats.removed + stats.alreadyRemoved + stats.notFound + stats.errors}/\${report.changes.length}... (\${stats.removed} removed)\`);
        }

        try {
          const response = await SurveyResponse.findOne({ responseId: change.responseId });
          
          if (!response) {
            stats.notFound++;
            continue;
          }

          // Check if question exists
          const questionIndex = response.responses.findIndex(r => r.questionId === QUESTION_ID);
          
          if (questionIndex === -1) {
            stats.alreadyRemoved++;
            continue;
          }

          // Remove the question response
          response.responses.splice(questionIndex, 1);
          response.updatedAt = new Date();
          await response.save();

          stats.removed++;
        } catch (err) {
          stats.errors++;
          console.error(\`   ❌ Error reversing \${change.responseId}:\`, err.message);
        }
      }
    }

    console.log('\\n' + '='.repeat(60));
    console.log('📊 REVERSAL SUMMARY');
    console.log('='.repeat(60));
    console.log(\`Total changes to reverse: \${stats.total}\`);
    console.log(\`✅ Successfully removed: \${stats.removed}\`);
    console.log(\`⏭️  Already removed: \${stats.alreadyRemoved}\`);
    console.log(\`❌ Errors: \${stats.errors}\`);
    console.log(\`📦 Not found in DB: \${stats.notFound}\`);
    console.log('='.repeat(60));

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


