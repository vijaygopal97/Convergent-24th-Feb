const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const SurveyResponse = require('../models/SurveyResponse');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const User = require('../models/User');
const Survey = require('../models/Survey');

// CSV Storage Directory
const CSV_STORAGE_DIR = path.join(__dirname, '../generated-csvs');
const REPORT_DIR = path.join(CSV_STORAGE_DIR, 'cati-reports');

// Ensure directories exist
if (!fs.existsSync(CSV_STORAGE_DIR)) {
  fs.mkdirSync(CSV_STORAGE_DIR, { recursive: true });
}
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 */
function escapeCSVField(field) {
  if (field === null || field === undefined) {
    return '';
  }
  const str = String(field);
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate CSV row from data object
 */
function generateCSVRow(data) {
  return Object.values(data).map(escapeCSVField).join(',');
}

/**
 * Generate CATI Responses Report
 */
async function generateCatiResponsesReport() {
  try {
    console.log('🚀 Starting CATI Responses Report Generation...');
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

    // First, get count and process in batches to avoid timeout
    // ALL TIME REPORT - No date filtering, only status filter
    console.log('📊 Counting ALL-TIME CATI responses (Approved, Rejected, Pending_Approval)...');
    const totalCount = await SurveyResponse.countDocuments({
      interviewMode: 'cati',
      status: { $in: ['Approved', 'Rejected', 'Pending_Approval'] }
      // No date filter - ALL TIME data
    });
    
    console.log(`📊 Total ALL-TIME CATI responses found: ${totalCount}`);
    
    if (totalCount === 0) {
      console.log('⚠️  No CATI responses found matching criteria');
      return null;
    }

    // Process in batches to avoid memory/timeout issues
    const BATCH_SIZE = 5000;
    const totalBatches = Math.ceil(totalCount / BATCH_SIZE);
    let allResponses = [];
    let processedCount = 0;

    console.log(`📦 Processing in ${totalBatches} batches of ${BATCH_SIZE}...`);

    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const skip = batchNum * BATCH_SIZE;
      console.log(`📦 Processing batch ${batchNum + 1}/${totalBatches} (skip: ${skip})...`);

      // Build aggregation pipeline for this batch
      const pipeline = [
        // Stage 1: Match CATI responses with required statuses (ALL TIME - no date filter)
        {
          $match: {
            interviewMode: 'cati',
            status: { $in: ['Approved', 'Rejected', 'Pending_Approval'] }
            // No date filter - getting ALL TIME data
          }
        },
        
        // Stage 2: Sort by startTime (oldest first) for chronological order
        {
          $sort: { startTime: 1 }
        },
        {
          $skip: skip
        },
        {
          $limit: BATCH_SIZE
        },
        
        // Stage 3: Lookup CatiCall using call_id
        {
          $lookup: {
            from: 'caticalls',
            localField: 'call_id',
            foreignField: 'callId',
            as: 'catiCall'
          }
        },
        
        // Stage 4: Unwind CatiCall (may be empty for some responses)
        {
          $unwind: {
            path: '$catiCall',
            preserveNullAndEmptyArrays: true
          }
        },
        
        // Stage 5: Lookup Interviewer details
        {
          $lookup: {
            from: 'users',
            localField: 'interviewer',
            foreignField: '_id',
            as: 'interviewerDetails'
          }
        },
        
        // Stage 6: Unwind Interviewer
        {
          $unwind: {
            path: '$interviewerDetails',
            preserveNullAndEmptyArrays: true
          }
        },
        
        // Stage 7: Lookup Survey details
        {
          $lookup: {
            from: 'surveys',
            localField: 'survey',
            foreignField: '_id',
            as: 'surveyDetails'
          }
        },
        
        // Stage 8: Unwind Survey
        {
          $unwind: {
            path: '$surveyDetails',
            preserveNullAndEmptyArrays: true
          }
        },
        
        // Stage 9: Project required fields (simplified - removed complex queue lookup for performance)
        {
          $project: {
            responseId: 1,
            _id: 1,
            surveyId: { $toString: '$survey' },
            surveyName: { $ifNull: ['$surveyDetails.surveyName', 'Unknown'] },
            interviewerId: { $ifNull: ['$interviewerDetails.memberId', ''] },
            interviewerName: {
              $concat: [
                { $ifNull: ['$interviewerDetails.firstName', ''] },
                ' ',
                { $ifNull: ['$interviewerDetails.lastName', ''] }
              ]
            },
            interviewerEmail: { $ifNull: ['$interviewerDetails.email', ''] },
            responseStatus: '$status',
            callId: '$call_id',
            // Respondent contact number from CatiCall
            respondentContactNumber: { $ifNull: ['$catiCall.toNumber', ''] },
            // Call status - prefer from CatiCall, fallback to knownCallStatus
            callStatus: {
              $cond: {
                if: { $and: ['$catiCall', { $ne: ['$catiCall.callStatus', null] }] },
                then: '$catiCall.callStatus',
                else: {
                  $cond: {
                    if: { $ne: ['$knownCallStatus', null] },
                    then: '$knownCallStatus',
                    else: 'unknown'
                  }
                }
              }
            },
            callDuration: { $ifNull: ['$catiCall.callDuration', 0] },
            callStartTime: { $ifNull: ['$catiCall.callStartTime', null] },
            callEndTime: { $ifNull: ['$catiCall.callEndTime', null] },
            startTime: 1,
            endTime: 1,
            totalTimeSpent: 1,
            createdAt: 1,
            updatedAt: 1,
            selectedAC: 1,
            setNumber: { $ifNull: ['$setNumber', ''] },
            OldinterviewerID: { $ifNull: ['$OldinterviewerID', ''] }
          }
        }
      ];

      const batchResponses = await SurveyResponse.aggregate(pipeline, {
        allowDiskUse: true,
        maxTimeMS: 300000 // 5 minutes per batch
      });

      allResponses = allResponses.concat(batchResponses);
      processedCount += batchResponses.length;
      console.log(`✅ Batch ${batchNum + 1} completed: ${batchResponses.length} responses (Total: ${processedCount}/${totalCount})`);
    }

    const responses = allResponses;

    console.log(`✅ Found ${responses.length} CATI responses`);

    if (responses.length === 0) {
      console.log('⚠️  No CATI responses found matching criteria');
      return null;
    }

    // Enrich with respondent contact numbers from queue (for responses missing contact number)
    console.log('📞 Enriching with respondent contact numbers from queue...');
    const responsesNeedingContact = responses.filter(r => r.callId && !r.respondentContactNumber);
    
    if (responsesNeedingContact.length > 0) {
      console.log(`📞 Looking up ${responsesNeedingContact.length} missing contact numbers...`);
      const callIds = responsesNeedingContact.map(r => r.callId);
      
      // Lookup by callAttempts.callId (most common case)
      const queueEntries = await CatiRespondentQueue.find({
        'callAttempts.callId': { $in: callIds }
      }).lean();

      // Create a map of callId -> respondent contact
      const contactMap = new Map();
      for (const queue of queueEntries) {
        if (queue.respondentContact?.phone) {
          const contact = (queue.respondentContact.countryCode || '') + (queue.respondentContact.phone || '');
          // Map all callIds from attempts
          if (queue.callAttempts && Array.isArray(queue.callAttempts)) {
            for (const attempt of queue.callAttempts) {
              if (attempt.callId) {
                contactMap.set(attempt.callId, contact);
              }
            }
          }
        }
      }

      // Also lookup by response reference (if queue has response linked)
      const responseIds = responsesNeedingContact.map(r => r._id);
      const queueEntriesByResponse = await CatiRespondentQueue.find({
        response: { $in: responseIds }
      }).lean();

      for (const queue of queueEntriesByResponse) {
        if (queue.respondentContact?.phone) {
          const contact = (queue.respondentContact.countryCode || '') + (queue.respondentContact.phone || '');
          // Find matching response and add contact
          const matchingResponse = responses.find(r => 
            r._id && queue.response && r._id.toString() === queue.response.toString()
          );
          if (matchingResponse && !matchingResponse.respondentContactNumber) {
            matchingResponse.respondentContactNumber = contact;
          }
        }
      }

      // Update responses with missing contact numbers from callAttempts map
      let enrichedCount = 0;
      for (const response of responses) {
        if (!response.respondentContactNumber && response.callId && contactMap.has(response.callId)) {
          response.respondentContactNumber = contactMap.get(response.callId);
          enrichedCount++;
        }
      }
      console.log(`✅ Enriched ${enrichedCount} responses with contact numbers from queue`);
    }

    // Sort all responses by startTime (oldest first) to ensure chronological order
    // Responses without startTime will be sorted to the end
    console.log('🔄 Sorting all responses by startTime (oldest to newest)...');
    allResponses.sort((a, b) => {
      const timeA = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER;
      return timeA - timeB; // Oldest first (nulls go to end)
    });

    // Generate CSV filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                      new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
    const filename = `cati_responses_report_ALL_TIME_${timestamp}.csv`;
    const filepath = path.join(REPORT_DIR, filename);

    console.log(`📝 Generating CSV file: ${filename}`);

    // Create write stream
    const writeStream = fs.createWriteStream(filepath, { encoding: 'utf8' });

    // CSV Headers
    const headers = [
      'Response ID',
      'Survey ID',
      'Survey Name',
      'Interviewer ID',
      'Interviewer Name',
      'Interviewer Email',
      'Respondent Contact Number',
      'Call Status',
      'Response Status',
      'Call ID',
      'Call Duration (seconds)',
      'Call Start Time',
      'Call End Time',
      'Interview Start Time',
      'Interview End Time',
      'Total Time Spent (seconds)',
      'Selected AC',
      'Set Number',
      'Old Interviewer ID',
      'Created At',
      'Updated At'
    ];

    // Write headers
    writeStream.write(generateCSVRow(headers) + '\n');

    // Write data rows
    let rowCount = 0;
    for (const response of responses) {
      const row = [
        response.responseId || response._id.toString(),
        response.surveyId || '',
        response.surveyName || '',
        response.interviewerId || '',
        (response.interviewerName || '').trim(),
        response.interviewerEmail || '',
        response.respondentContactNumber || '',
        response.callStatus || 'unknown',
        response.responseStatus || '',
        response.callId || '',
        response.callDuration || 0,
        response.callStartTime ? new Date(response.callStartTime).toISOString() : '',
        response.callEndTime ? new Date(response.callEndTime).toISOString() : '',
        response.startTime ? new Date(response.startTime).toISOString() : '',
        response.endTime ? new Date(response.endTime).toISOString() : '',
        response.totalTimeSpent || 0,
        response.selectedAC || '',
        response.setNumber || '',
        response.OldinterviewerID || '',
        response.createdAt ? new Date(response.createdAt).toISOString() : '',
        response.updatedAt ? new Date(response.updatedAt).toISOString() : ''
      ];
      
      writeStream.write(generateCSVRow(row) + '\n');
      rowCount++;
      
      // Log progress every 1000 rows
      if (rowCount % 1000 === 0) {
        console.log(`📊 Processed ${rowCount}/${responses.length} responses...`);
      }
    }

    // Close write stream
    writeStream.end();

    // Wait for stream to finish
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`✅ CSV report generated successfully!`);
    console.log(`📁 File path: ${filepath}`);
    console.log(`📊 Total rows: ${rowCount + 1} (including header)`);
    console.log(`📊 Total responses: ${rowCount}`);

    // Get file size
    const stats = fs.statSync(filepath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`📦 File size: ${fileSizeMB} MB`);

    return filepath;

  } catch (error) {
    console.error('❌ Error generating CATI responses report:', error);
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
  generateCatiResponsesReport()
    .then((filepath) => {
      if (filepath) {
        console.log('\n✅ Report generation completed successfully!');
        console.log(`📁 Report saved at: ${filepath}`);
        process.exit(0);
      } else {
        console.log('\n⚠️  No data found to generate report');
        process.exit(0);
      }
    })
    .catch((error) => {
      console.error('\n❌ Report generation failed:', error);
      process.exit(1);
    });
}

module.exports = { generateCatiResponsesReport };

