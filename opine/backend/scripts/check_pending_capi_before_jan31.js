#!/usr/bin/env node

/**
 * Check Pending Approval CAPI Responses Before January 31st
 * 
 * This script checks how many CAPI survey responses are in "Pending_Approval" status
 * with startTime before January 31st
 */

const mongoose = require('mongoose');
const path = require('path');

const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

/**
 * Main function
 */
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // January 31st, 2026
    const jan31_2026 = new Date('2026-01-31T23:59:59.999Z');
    
    // Also check for 2025
    const jan31_2025 = new Date('2025-01-31T23:59:59.999Z');
    
    console.log('\n' + '='.repeat(70));
    console.log('CHECKING PENDING APPROVAL CAPI RESPONSES BEFORE JANUARY 31ST');
    console.log('='.repeat(70));
    
    // Check for 2026 - CAPI only
    console.log(`\n📊 Checking for CAPI responses before January 31st, 2026...`);
    const count2026 = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      startTime: { $lt: jan31_2026 }
    });
    
    console.log(`✅ Found ${count2026} CAPI responses in Pending_Approval before Jan 31, 2026`);
    
    // Check for 2025 - CAPI only
    console.log(`\n📊 Checking for CAPI responses before January 31st, 2025...`);
    const count2025 = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      interviewMode: 'capi',
      startTime: { $lt: jan31_2025 }
    });
    
    console.log(`✅ Found ${count2025} CAPI responses in Pending_Approval before Jan 31, 2025`);
    
    // Get more details for 2026
    if (count2026 > 0) {
      console.log(`\n📋 Getting details for CAPI responses before Jan 31, 2026...`);
      
      const pipeline = [
        {
          $match: {
            status: 'Pending_Approval',
            interviewMode: 'capi',
            startTime: { $lt: jan31_2026 }
          }
        },
        {
          $group: {
            _id: {
              survey: '$survey'
            },
            count: { $sum: 1 },
            oldestStartTime: { $min: '$startTime' },
            newestStartTime: { $max: '$startTime' }
          }
        },
        {
          $lookup: {
            from: 'surveys',
            localField: '_id.survey',
            foreignField: '_id',
            as: 'surveyInfo'
          }
        },
        {
          $unwind: {
            path: '$surveyInfo',
            preserveNullAndEmptyArrays: true
          }
        },
        {
          $project: {
            surveyName: '$surveyInfo.surveyName',
            surveyId: '$_id.survey',
            count: 1,
            oldestStartTime: 1,
            newestStartTime: 1
          }
        },
        {
          $sort: { count: -1 }
        }
      ];
      
      const details = await SurveyResponse.aggregate(pipeline);
      
      console.log(`\n📊 Breakdown by Survey:\n`);
      details.forEach((item, index) => {
        console.log(`${index + 1}. ${item.surveyName || 'Unknown Survey'}`);
        console.log(`   Count: ${item.count}`);
        console.log(`   Oldest: ${item.oldestStartTime ? new Date(item.oldestStartTime).toISOString() : 'N/A'}`);
        console.log(`   Newest: ${item.newestStartTime ? new Date(item.newestStartTime).toISOString() : 'N/A'}`);
        console.log('');
      });
      
      // Get sample of oldest responses
      console.log(`\n📋 Sample of oldest CAPI responses (first 10):`);
      const sample = await SurveyResponse.find({
        status: 'Pending_Approval',
        interviewMode: 'capi',
        startTime: { $lt: jan31_2026 }
      })
      .sort({ startTime: 1 })
      .limit(10)
      .populate('survey', 'surveyName')
      .populate('interviewer', 'firstName lastName memberId')
      .select('responseId startTime endTime interviewMode survey interviewer status');
      
      sample.forEach((response, index) => {
        console.log(`\n${index + 1}. Response ID: ${response.responseId || 'N/A'}`);
        console.log(`   Survey: ${response.survey?.surveyName || 'N/A'}`);
        console.log(`   Interviewer: ${response.interviewer?.firstName || ''} ${response.interviewer?.lastName || ''} (${response.interviewer?.memberId || 'N/A'})`);
        console.log(`   Mode: ${response.interviewMode || 'N/A'}`);
        console.log(`   Start Time: ${response.startTime ? new Date(response.startTime).toISOString() : 'N/A'}`);
        console.log(`   End Time: ${response.endTime ? new Date(response.endTime).toISOString() : 'N/A'}`);
        console.log(`   Status: ${response.status}`);
      });
      
      // Get date distribution
      console.log(`\n📊 Date Distribution:`);
      const datePipeline = [
        {
          $match: {
            status: 'Pending_Approval',
            interviewMode: 'capi',
            startTime: { $lt: jan31_2026 }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$startTime' }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ];
      
      const dateDistribution = await SurveyResponse.aggregate(datePipeline);
      dateDistribution.forEach(item => {
        console.log(`   ${item._id}: ${item.count} responses`);
      });
    }
    
    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`CAPI Pending_Approval before Jan 31, 2026: ${count2026}`);
    console.log(`CAPI Pending_Approval before Jan 31, 2025: ${count2025}`);
    console.log('='.repeat(70));
    
    await mongoose.connection.close();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
}

main();











































