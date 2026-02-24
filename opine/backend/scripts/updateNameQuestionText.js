const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

/**
 * Update questionText in survey responses from "What is your name?" to "What is your full name?"
 * Preserves translations and other parts of the question text
 */
async function updateNameQuestionText() {
  try {
    console.log('🚀 Starting Name Question Text Update...');
    console.log('📅 Date:', new Date().toISOString());
    
    // Connect to MongoDB
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB');

    // Find all responses that contain "What is your name" but NOT "What is your full name" (case insensitive)
    // Using regex to match various formats: "What is your name?", "what is your name?", etc.
    console.log('📊 Searching for responses with "What is your name?" question (excluding already updated ones)...');
    
    const query = {
      $and: [
        {
          'responses.questionText': {
            $regex: /what\s+is\s+your\s+name/i  // Case-insensitive regex
          }
        },
        {
          'responses.questionText': {
            $not: {
              $regex: /what\s+is\s+your\s+full\s+name/i  // Exclude already updated
            }
          }
        }
      ]
    };

    const totalResponses = await SurveyResponse.countDocuments(query);
    console.log(`📊 Found ${totalResponses} survey responses with "What is your name?" question`);

    if (totalResponses === 0) {
      console.log('✅ No responses found to update');
      return;
    }

    // Process in batches to avoid memory issues
    const BATCH_SIZE = 1000;
    let processedCount = 0;
    let updatedCount = 0;
    let skip = 0;

    console.log(`📦 Processing in batches of ${BATCH_SIZE}...`);

    while (processedCount < totalResponses) {
      const responses = await SurveyResponse.find(query)
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (responses.length === 0) break;

      console.log(`📦 Processing batch: ${skip + 1} to ${skip + responses.length}...`);

      // Process each response
      for (const response of responses) {
        let hasChanges = false;
        const updatedResponses = response.responses.map((resp) => {
            if (resp.questionText) {
              // Check if questionText contains "What is your name" (case insensitive, with or without ?)
              // But exclude if it already has "full name"
              const questionTextLower = resp.questionText.toLowerCase();
              if (questionTextLower.includes('what is your name') && 
                  !questionTextLower.includes('what is your full name')) {
                // Replace "What is your name" or "What is your name?" with "What is your full name" or "What is your full name?"
                // Preserve everything else (translations, formatting, etc.)
                // Handle variations: with/without question mark, different spacing
                const preciseReplacement = resp.questionText.replace(
                  /(what\s+is\s+your\s+)name(\s*\?)?/gi,
                  (match, prefix, questionMark) => {
                    // Preserve original case and question mark
                    return prefix + 'full name' + (questionMark || '');
                  }
                );
                
                hasChanges = true;
                return {
                  ...resp,
                  questionText: preciseReplacement
                };
              }
            }
          return resp;
        });

        if (hasChanges) {
          // Update the response document
          await SurveyResponse.updateOne(
            { _id: response._id },
            { $set: { responses: updatedResponses } }
          );
          updatedCount++;
        }
      }

      processedCount += responses.length;
      skip += BATCH_SIZE;
      console.log(`✅ Processed ${processedCount}/${totalResponses} responses (${updatedCount} updated so far)...`);
    }

    console.log('\n✅ Update completed successfully!');
    console.log(`📊 Total responses processed: ${processedCount}`);
    console.log(`📊 Total responses updated: ${updatedCount}`);

  } catch (error) {
    console.error('❌ Error updating name question text:', error);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('🔌 MongoDB connection closed');
    }
  }
}

// Run the script if called directly
if (require.main === module) {
  updateNameQuestionText()
    .then(() => {
      console.log('\n✅ Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { updateNameQuestionText };

