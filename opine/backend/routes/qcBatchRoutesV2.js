const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getBatchesBySurveyV2,
  getBatchByIdV2
} = require('../controllers/qcBatchControllerV2');

// All routes require authentication
router.use(protect);

// Get batches for a survey (V2 - Optimized)
router.get('/survey/:surveyId', getBatchesBySurveyV2);

// Get a single batch (V2 - Optimized)
router.get('/:batchId', getBatchByIdV2);

module.exports = router;










