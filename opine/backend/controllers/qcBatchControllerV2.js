const mongoose = require('mongoose');
const QCBatch = require('../models/QCBatch');
const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const qcBatchCache = require('../utils/qcBatchCache');

/**
 * @desc    Get all QC batches for a survey (V2 - Optimized with pagination, aggregation, caching)
 * @route   GET /api/qc-batches-v2/survey/:surveyId
 * @access  Private (Company Admin, Project Manager)
 * 
 * OPTIMIZATIONS:
 * - Pagination (page, limit)
 * - MongoDB aggregation pipeline (single query instead of N+1)
 * - Redis caching (5min TTL)
 * - Lean queries (plain objects, not Mongoose documents)
 * - Pre-calculated stats from batch document
 */
const getBatchesBySurveyV2 = async (req, res) => {
  try {
    const { surveyId } = req.params;
    const {
      page = 1,
      limit = 20,
      status,
      interviewerId
    } = req.query;
    
    const companyId = req.user.company;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skip = (pageNum - 1) * limitNum;
    
    // Verify survey belongs to company
    const survey = await Survey.findOne({
      _id: surveyId,
      company: companyId
    }).lean();
    
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }
    
    // Build filters
    const filters = { status, interviewerId };
    
    // Try cache first
    const cached = await qcBatchCache.getBatchList(surveyId, {
      page: pageNum,
      limit: limitNum,
      status,
      interviewerId,
      useCache: true
    });
    
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }
    
    // Build match filter for aggregation
    const matchFilter = { survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId };
    
    if (status && status !== 'all' && status !== '') {
      matchFilter.status = status;
    }
    
    if (interviewerId && mongoose.Types.ObjectId.isValid(interviewerId)) {
      matchFilter.interviewer = new mongoose.Types.ObjectId(interviewerId);
    }
    
    // CRITICAL: Use aggregation pipeline instead of N+1 queries
    // This is THE KEY optimization - single query instead of 1 + (N*2) queries
    const pipeline = [
      // Stage 1: Match batches
      { $match: matchFilter },
      
      // Stage 2: Sort by batchDate (newest first)
      { $sort: { batchDate: -1 } },
      
      // Stage 3: Lookup interviewer details (only for current page)
      {
        $lookup: {
          from: 'users',
          localField: 'interviewer',
          foreignField: '_id',
          as: 'interviewerDetails'
        }
      },
      {
        $unwind: {
          path: '$interviewerDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      
      // Stage 4: Lookup survey name (lightweight)
      {
        $lookup: {
          from: 'surveys',
          localField: 'survey',
          foreignField: '_id',
          as: 'surveyDetails',
          pipeline: [
            { $project: { surveyName: 1 } }
          ]
        }
      },
      {
        $unwind: {
          path: '$surveyDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      
      // Stage 5: Calculate stats from sampleResponses using aggregation
      // CRITICAL: This replaces the N+1 query pattern
      {
        $lookup: {
          from: 'surveyresponses',
          let: { sampleIds: '$sampleResponses' },
          pipeline: [
            {
              $match: {
                $expr: { $in: ['$_id', '$$sampleIds'] }
              }
            },
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          as: 'sampleStats'
        }
      },
      
      // Stage 6: Transform stats into realTimeStats format
      {
        $addFields: {
          realTimeStats: {
            approvedCount: {
              $let: {
                vars: {
                  approved: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$sampleStats',
                          as: 'stat',
                          cond: { $eq: ['$$stat._id', 'Approved'] }
                        }
                      },
                      0
                    ]
                  }
                },
                in: { $ifNull: ['$$approved.count', 0] }
              }
            },
            rejectedCount: {
              $let: {
                vars: {
                  rejected: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$sampleStats',
                          as: 'stat',
                          cond: { $eq: ['$$stat._id', 'Rejected'] }
                        }
                      },
                      0
                    ]
                  }
                },
                in: { $ifNull: ['$$rejected.count', 0] }
              }
            },
            pendingCount: {
              $let: {
                vars: {
                  pending: {
                    $arrayElemAt: [
                      {
                        $filter: {
                          input: '$sampleStats',
                          as: 'stat',
                          cond: { $eq: ['$$stat._id', 'Pending_Approval'] }
                        }
                      },
                      0
                    ]
                  }
                },
                in: { $ifNull: ['$$pending.count', 0] }
              }
            }
          }
        }
      },
      
      // Stage 7: Calculate approval rate
      {
        $addFields: {
          'realTimeStats.totalQCed': {
            $add: ['$realTimeStats.approvedCount', '$realTimeStats.rejectedCount']
          }
        }
      },
      {
        $addFields: {
          'realTimeStats.approvalRate': {
            $cond: {
              if: { $gt: ['$realTimeStats.totalQCed', 0] },
              then: {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: ['$realTimeStats.approvedCount', '$realTimeStats.totalQCed']
                      },
                      100
                    ]
                  },
                  2
                ]
              },
              else: 0
            }
          }
        }
      },
      
      // Stage 8: Project only needed fields (memory optimization)
      {
        $project: {
          _id: 1,
          survey: 1,
          interviewer: {
            _id: '$interviewerDetails._id',
            firstName: '$interviewerDetails.firstName',
            lastName: '$interviewerDetails.lastName',
            email: '$interviewerDetails.email'
          },
          batchDate: 1,
          status: 1,
          totalResponses: 1,
          sampleSize: 1,
          remainingSize: 1,
          qcStats: 1,
          remainingDecision: 1,
          processingStartedAt: 1,
          processingCompletedAt: 1,
          batchConfig: 1,
          metadata: 1,
          createdAt: 1,
          updatedAt: 1,
          surveyName: '$surveyDetails.surveyName',
          realTimeStats: 1,
          // Don't include full responses array - too large, load on demand
          responseCount: { $size: { $ifNull: ['$responses', []] } }
        }
      },
      
      // Stage 9: Get total count (before pagination)
      {
        $facet: {
          metadata: [
            { $count: 'total' }
          ],
          data: [
            { $skip: skip },
            { $limit: limitNum }
          ]
        }
      }
    ];
    
    // Execute aggregation
    const result = await QCBatch.aggregate(pipeline).read('secondaryPreferred').allowDiskUse(true);
    
    if (!result || result.length === 0) {
      const responseData = {
        batches: [],
        pagination: {
          currentPage: pageNum,
          totalPages: 0,
          totalBatches: 0,
          limit: limitNum,
          hasNextPage: false,
          hasPrevPage: false
        }
      };
      
      // Cache empty result
      await qcBatchCache.setBatchList(surveyId, pageNum, limitNum, filters, responseData);
      
      return res.json({
        success: true,
        data: responseData
      });
    }
    
    const metadata = result[0].metadata[0] || { total: 0 };
    const batches = result[0].data || [];
    const totalBatches = metadata.total;
    const totalPages = Math.ceil(totalBatches / limitNum);
    
    const responseData = {
      batches: batches,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalBatches: totalBatches,
        limit: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      }
    };
    
    // Cache the result
    await qcBatchCache.setBatchList(surveyId, pageNum, limitNum, filters, responseData);
    
    res.json({
      success: true,
      data: responseData
    });
    
  } catch (error) {
    console.error('Error fetching QC batches V2:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch QC batches',
      error: error.message
    });
  }
};

/**
 * @desc    Get a single QC batch with paginated responses (V2 - Optimized)
 * @route   GET /api/qc-batches-v2/:batchId
 * @access  Private (Company Admin, Project Manager)
 * 
 * OPTIMIZATIONS:
 * - Pagination for responses (responsePage, responseLimit)
 * - Redis caching
 * - Lean queries
 * - Selective field loading
 * - Pre-calculated stats
 */
const getBatchByIdV2 = async (req, res) => {
  try {
    const { batchId } = req.params;
    const {
      responsePage = 1,
      responseLimit = 50
    } = req.query;
    
    const companyId = req.user.company;
    const responsePageNum = parseInt(responsePage, 10) || 1;
    const responseLimitNum = parseInt(responseLimit, 10) || 50;
    const responseSkip = (responsePageNum - 1) * responseLimitNum;
    
    // Try cache first
    const cached = await qcBatchCache.getBatchDetails(batchId, responsePageNum, responseLimitNum);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true
      });
    }
    
    // Get batch (lean for memory efficiency)
    const batch = await QCBatch.findById(batchId)
      .populate('survey', 'surveyName company')
      .populate('interviewer', 'firstName lastName email')
      .lean();
    
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'QC batch not found'
      });
    }
    
    // Verify batch belongs to company
    if (batch.survey.company.toString() !== companyId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this batch'
      });
    }
    
    // CRITICAL: Use aggregation for responses with pagination
    // This prevents loading ALL responses into memory
    const responsePipeline = [
      {
        $match: {
          _id: { $in: batch.responses.map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id) }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'interviewer',
          foreignField: '_id',
          as: 'interviewerDetails',
          pipeline: [
            { $project: { firstName: 1, lastName: 1, email: 1 } }
          ]
        }
      },
      {
        $unwind: {
          path: '$interviewerDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          responseId: 1,
          status: 1,
          createdAt: 1,
          interviewMode: 1,
          qcBatch: 1,
          isSampleResponse: 1,
          verificationData: 1,
          audioRecording: 1,
          call_id: 1,
          startTime: 1,
          endTime: 1,
          totalTimeSpent: 1,
          location: 1,
          selectedAC: 1,
          qualityMetrics: 1,
          metadata: 1,
          interviewer: {
            _id: '$interviewerDetails._id',
            firstName: '$interviewerDetails.firstName',
            lastName: '$interviewerDetails.lastName',
            email: '$interviewerDetails.email'
          }
          // CRITICAL: Don't load full responses array - too large
          // Load on demand when viewing individual response
        }
      },
      {
        $facet: {
          metadata: [
            { $count: 'total' }
          ],
          data: [
            { $skip: responseSkip },
            { $limit: responseLimitNum }
          ]
        }
      }
    ];
    
    const responseResult = await SurveyResponse.aggregate(responsePipeline).read('secondaryPreferred').allowDiskUse(true);
    
    const allResponsesMetadata = responseResult[0]?.metadata[0] || { total: 0 };
    const allResponses = responseResult[0]?.data || [];
    const totalResponses = allResponsesMetadata.total;
    
    // Separate sample and remaining responses (only for current page)
    const sampleResponseIds = new Set(batch.sampleResponses.map(id => id.toString()));
    const remainingResponseIds = new Set(batch.remainingResponses.map(id => id.toString()));
    
    const sampleResponses = allResponses.filter(r => sampleResponseIds.has(r._id.toString()));
    const remainingResponses = allResponses.filter(r => remainingResponseIds.has(r._id.toString()));
    
    // Calculate stats from pre-calculated qcStats (already in batch document)
    // This avoids querying all sample responses
    const realTimeStats = {
      approvedCount: batch.qcStats?.approvedCount || 0,
      rejectedCount: batch.qcStats?.rejectedCount || 0,
      pendingCount: batch.qcStats?.pendingCount || 0,
      approvalRate: batch.qcStats?.approvalRate || 0,
      totalQCed: (batch.qcStats?.approvedCount || 0) + (batch.qcStats?.rejectedCount || 0)
    };
    
    const responseData = {
      batch: {
        _id: batch._id,
        survey: {
          _id: batch.survey._id || batch.survey,
          surveyName: batch.survey.surveyName
        },
        interviewer: batch.interviewer,
        batchDate: batch.batchDate,
        status: batch.status,
        totalResponses: batch.totalResponses,
        sampleSize: batch.sampleSize,
        remainingSize: batch.remainingSize,
        qcStats: batch.qcStats,
        remainingDecision: batch.remainingDecision,
        processingStartedAt: batch.processingStartedAt,
        processingCompletedAt: batch.processingCompletedAt,
        batchConfig: batch.batchConfig,
        metadata: batch.metadata,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        realTimeStats: realTimeStats
      },
      responses: {
        all: allResponses,
        sample: sampleResponses,
        remaining: remainingResponses,
        pagination: {
          currentPage: responsePageNum,
          totalPages: Math.ceil(totalResponses / responseLimitNum),
          totalResponses: totalResponses,
          limit: responseLimitNum,
          hasNextPage: responsePageNum < Math.ceil(totalResponses / responseLimitNum),
          hasPrevPage: responsePageNum > 1
        }
      }
    };
    
    // Cache the result
    await qcBatchCache.setBatchDetails(batchId, responsePageNum, responseLimitNum, responseData);
    
    res.json({
      success: true,
      data: responseData
    });
    
  } catch (error) {
    console.error('Error fetching QC batch V2:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch QC batch',
      error: error.message
    });
  }
};

module.exports = {
  getBatchesBySurveyV2,
  getBatchByIdV2
};
