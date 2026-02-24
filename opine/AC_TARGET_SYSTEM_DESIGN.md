# AC Target-Based Respondent Assignment System - Design Document

## 📋 Requirement Analysis

### Current System Behavior:
1. **When AC is assigned to interviewer:**
   - Only contacts from assigned AC(s) are assigned
   - Works perfectly ✅

2. **When AC is NOT assigned to interviewer:**
   - Uses priority-based selection from `CATI_AC_Priority.json`
   - All ACs with priority > 0 are considered
   - No target tracking

### New Requirement:
**When AC is NOT assigned to interviewer:**
- Set **TARGETS** for each AC (only ACs with targets will be considered)
- **Target = Approved + Pending Approval count** per AC
- When a response is **rejected** → automatically assign new contact to maintain target
- System should maintain: `Approved + Pending Approval = Target` for each AC

---

## 🎯 System Design

### 1. Database Schema Changes

#### 1.1 Add to Survey Model (`Survey.js`)

```javascript
// Add to Survey schema
acTargets: [{
  acName: {
    type: String,
    required: true,
    trim: true
  },
  target: {
    type: Number,
    required: true,
    min: 0
  },
  enabled: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}]
```

**Example:**
```javascript
{
  acTargets: [
    { acName: "Kalchini", target: 100, enabled: true },
    { acName: "Jhargram", target: 150, enabled: true },
    { acName: "Satgachhia", target: 200, enabled: true }
  ]
}
```

#### 1.2 Add to SurveyResponse Model (Optional - for tracking)

```javascript
// Already exists: selectedAC field
// We'll use this to track which AC the response belongs to
```

#### 1.3 Create ACTargetCount Model (for efficient counting)

```javascript
// New model: ACTargetCount.js
{
  survey: ObjectId,        // Survey reference
  acName: String,          // AC name
  approvedCount: Number,   // Count of Approved responses
  pendingCount: Number,    // Count of Pending_Approval responses
  target: Number,          // Target count
  lastUpdated: Date        // Last count update
}
```

**Why separate model?**
- Efficient counting (aggregation)
- Redis cacheable
- Fast lookups without scanning all responses

---

## 2. Core Logic Flow

### 2.1 Respondent Assignment Logic (Modified)

**File:** `catiInterviewController.js` → `startCatiInterview()`

**Current Flow:**
```
1. Check if interviewer has assignedACs
   YES → Only consider assigned ACs
   NO → Use priority-based selection
```

**New Flow:**
```
1. Check if interviewer has assignedACs
   YES → Only consider assigned ACs (unchanged)
   NO → Check if survey has acTargets
        YES → Use target-based selection (NEW)
        NO → Use priority-based selection (fallback)
```

### 2.2 Target-Based Selection Logic

```javascript
// Pseudo-code
1. Get all ACs with targets (from survey.acTargets)
2. For each AC with target:
   a. Get current count: Approved + Pending Approval
   b. Calculate deficit: target - currentCount
   c. If deficit > 0 → AC needs more responses
3. Sort ACs by deficit (highest deficit first)
4. Select respondent from AC with highest deficit
5. If multiple ACs have same deficit → use priority as tiebreaker
```

### 2.3 Auto-Refill Logic (When Rejection Happens)

**File:** `surveyResponseController.js` → `submitVerification()`

**When status changes to 'Rejected':**
```javascript
1. Extract AC name from rejected response
2. Check if AC has target in survey.acTargets
3. If yes:
   a. Get current count: Approved + Pending Approval
   b. Calculate deficit: target - currentCount
   c. If deficit > 0:
      - Find next pending respondent from this AC
      - Assign to any available interviewer (without assigned ACs)
      - OR queue for assignment in next interview start
```

---

## 3. Implementation Details

### 3.1 ACTargetCount Service (New File)

**File:** `/var/www/opine/backend/utils/acTargetCountHelper.js`

```javascript
/**
 * Get current count for an AC (Approved + Pending Approval)
 * Uses aggregation for efficiency
 */
async function getACCount(surveyId, acName) {
  // Use MongoDB aggregation
  const result = await SurveyResponse.aggregate([
    {
      $match: {
        survey: mongoose.Types.ObjectId(surveyId),
        selectedAC: acName,
        status: { $in: ['Approved', 'Pending_Approval'] }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const approved = result.find(r => r._id === 'Approved')?.count || 0;
  const pending = result.find(r => r._id === 'Pending_Approval')?.count || 0;
  
  return {
    approved,
    pending,
    total: approved + pending
  };
}

/**
 * Get all ACs with targets and their current counts
 */
async function getACTargetsWithCounts(surveyId) {
  const survey = await Survey.findById(surveyId).select('acTargets').lean();
  if (!survey || !survey.acTargets || survey.acTargets.length === 0) {
    return [];
  }
  
  const targetsWithCounts = await Promise.all(
    survey.acTargets
      .filter(t => t.enabled)
      .map(async (target) => {
        const counts = await getACCount(surveyId, target.acName);
        return {
          acName: target.acName,
          target: target.target,
          currentCount: counts.total,
          approvedCount: counts.approved,
          pendingCount: counts.pending,
          deficit: Math.max(0, target.target - counts.total)
        };
      })
  );
  
  return targetsWithCounts.sort((a, b) => b.deficit - a.deficit); // Highest deficit first
}
```

### 3.2 Modified Respondent Assignment

**File:** `catiInterviewController.js` → `startCatiInterview()`

**Add after line 566 (hasAssignedACs check):**

```javascript
// NEW: Target-based selection for interviewers without assigned ACs
if (!hasAssignedACs) {
  const acTargetsHelper = require('../utils/acTargetCountHelper');
  const targetsWithCounts = await acTargetsHelper.getACTargetsWithCounts(surveyId);
  
  if (targetsWithCounts && targetsWithCounts.length > 0) {
    console.log('🎯 Using target-based AC selection');
    
    // Filter ACs that need more responses (deficit > 0)
    const acsNeedingResponses = targetsWithCounts.filter(t => t.deficit > 0);
    
    if (acsNeedingResponses.length > 0) {
      // Select AC with highest deficit
      const targetAC = acsNeedingResponses[0];
      console.log(`🎯 Target AC: ${targetAC.acName} (deficit: ${targetAC.deficit}, target: ${targetAC.target}, current: ${targetAC.currentCount})`);
      
      // Modify priority map to only include this AC
      // This ensures we only get respondents from ACs that need responses
      const targetACNames = acsNeedingResponses.map(t => t.acName);
      
      // Filter priority map to only include target ACs
      const filteredPriorityMap = {};
      for (const [acName, priority] of Object.entries(acPriorityMap)) {
        if (targetACNames.includes(acName)) {
          filteredPriorityMap[acName] = priority;
        }
      }
      
      acPriorityMap = filteredPriorityMap;
      console.log(`🎯 Filtered priority map to ${Object.keys(filteredPriorityMap).length} target ACs`);
    } else {
      console.log('🎯 All ACs have reached their targets, falling back to priority-based selection');
    }
  }
}
```

### 3.3 Auto-Refill on Rejection

**File:** `surveyResponseController.js` → `submitVerification()`

**Add after status update to 'Rejected':**

```javascript
// NEW: Auto-refill logic when response is rejected
if (newStatus === 'Rejected') {
  const acName = surveyResponse.selectedAC;
  
  if (acName) {
    const acTargetsHelper = require('../utils/acTargetCountHelper');
    const survey = await Survey.findById(surveyResponse.survey).select('acTargets').lean();
    
    // Check if this AC has a target
    const acTarget = survey?.acTargets?.find(t => t.acName === acName && t.enabled);
    
    if (acTarget) {
      // Get current count
      const counts = await acTargetsHelper.getACCount(surveyResponse.survey, acName);
      const deficit = acTarget.target - counts.total;
      
      if (deficit > 0) {
        console.log(`🔄 Auto-refill: AC ${acName} needs ${deficit} more responses (target: ${acTarget.target}, current: ${counts.total})`);
        
        // Queue refill job (non-blocking)
        const { addRefillJob } = require('../queues/acTargetRefillQueue');
        await addRefillJob({
          surveyId: surveyResponse.survey.toString(),
          acName: acName,
          deficit: deficit
        });
      }
    }
  }
}
```

### 3.4 Refill Queue Worker

**New File:** `/var/www/opine/backend/queues/acTargetRefillQueue.js`

```javascript
const { Queue, Worker } = require('bullmq');
const redisOps = require('../utils/redisClient');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');

const refillQueue = new Queue('ac-target-refill', {
  connection: redisOps.connection
});

const addRefillJob = async (jobData) => {
  return await refillQueue.add('refill-ac-target', jobData, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    }
  });
};

// Worker processes refill jobs
const refillWorker = new Worker('ac-target-refill', async (job) => {
  const { surveyId, acName, deficit } = job.data;
  
  // Find pending respondents from this AC
  const pendingRespondents = await CatiRespondentQueue.find({
    survey: surveyId,
    'respondentContact.ac': acName,
    status: 'pending'
  })
    .sort({ createdAt: 1 })
    .limit(deficit)
    .lean();
  
  // Add to Redis queue for fast assignment
  const catiQueueCache = require('../utils/catiQueueCache');
  const acPriorityMap = await loadACPriorityMap();
  const priority = acPriorityMap[acName] || 999; // Default priority if not in map
  
  for (const respondent of pendingRespondents) {
    await catiQueueCache.rpushRespondent(
      surveyId,
      acName,
      priority,
      respondent._id.toString()
    );
  }
  
  console.log(`✅ Refilled ${pendingRespondents.length} respondents for AC ${acName}`);
}, {
  connection: redisOps.connection,
  concurrency: 5
});

module.exports = { addRefillJob, refillQueue };
```

---

## 4. API Endpoints

### 4.1 Manage AC Targets

```
GET    /api/surveys/:surveyId/ac-targets          - Get all AC targets
POST   /api/surveys/:surveyId/ac-targets          - Set AC targets (bulk)
PUT    /api/surveys/:surveyId/ac-targets/:acName  - Update single AC target
DELETE /api/surveys/:surveyId/ac-targets/:acName  - Remove AC target
GET    /api/surveys/:surveyId/ac-targets/stats    - Get targets with current counts
```

### 4.2 Example Request

```javascript
// POST /api/surveys/68fd1915d41841da463f0d46/ac-targets
{
  "targets": [
    { "acName": "Kalchini", "target": 100 },
    { "acName": "Jhargram", "target": 150 },
    { "acName": "Satgachhia", "target": 200 }
  ]
}
```

---

## 5. Integration Points

### 5.1 Files to Modify

1. **`/var/www/opine/backend/models/Survey.js`**
   - Add `acTargets` field to schema

2. **`/var/www/opine/backend/controllers/catiInterviewController.js`**
   - Modify `startCatiInterview()` to check targets when no AC assigned
   - Lines ~560-800 (respondent selection logic)

3. **`/var/www/opine/backend/controllers/surveyResponseController.js`**
   - Modify `submitVerification()` to trigger refill on rejection
   - Lines ~4723-4974

4. **`/var/www/opine/backend/controllers/surveyController.js`**
   - Add endpoints for managing AC targets

### 5.2 New Files to Create

1. **`/var/www/opine/backend/utils/acTargetCountHelper.js`**
   - Helper functions for counting and managing targets

2. **`/var/www/opine/backend/queues/acTargetRefillQueue.js`**
   - Queue for processing refill jobs

3. **`/var/www/opine/backend/workers/acTargetRefillWorker.js`**
   - Worker for processing refill jobs (or integrate into existing worker)

---

## 6. Performance Optimization

### 6.1 Redis Caching

```javascript
// Cache AC counts (5 minute TTL)
const CACHE_KEY = `ac:target:count:${surveyId}:${acName}`;
const cached = await redisOps.get(CACHE_KEY);
if (cached) return cached;

// Calculate and cache
const count = await calculateACCount(surveyId, acName);
await redisOps.set(CACHE_KEY, count, 300); // 5 minutes
```

### 6.2 Incremental Updates

Instead of recalculating on every request:
- **On Approval:** Increment count in cache
- **On Rejection:** Decrement count, trigger refill
- **On Pending → Approved:** Increment approved, decrement pending
- **Periodic Sync:** Recalculate from DB every 15 minutes

### 6.3 Batch Processing

- Process refills in batches (not one-by-one)
- Use MongoDB aggregation for counting (efficient)
- Queue refill jobs (non-blocking)

---

## 7. Edge Cases & Error Handling

### 7.1 No Pending Respondents Available

**Scenario:** AC needs refill but no pending respondents exist

**Solution:**
- Log warning
- Mark AC as "needs attention"
- Notify admin via dashboard
- Continue with other ACs

### 7.2 Target Changed Mid-Process

**Scenario:** Admin changes target while interviews are in progress

**Solution:**
- Use current target at time of assignment
- Recalculate on next assignment
- Don't retroactively adjust

### 7.3 Multiple Interviewers Without Assigned ACs

**Scenario:** Multiple interviewers competing for same AC respondents

**Solution:**
- Use existing LPOP queue system (atomic)
- Each interviewer gets different respondent
- Queue automatically refills

### 7.4 AC Name Mismatch

**Scenario:** Response has different AC name format than target

**Solution:**
- Normalize AC names (trim, case-insensitive)
- Use consistent AC name format
- Add validation on target creation

---

## 8. Monitoring & Reporting

### 8.1 Dashboard Metrics

- **AC Target Status:** Show target vs current for each AC
- **Refill Queue:** Show pending refill jobs
- **Deficit Alerts:** Highlight ACs with high deficit

### 8.2 Logging

```javascript
logger.info('AC target assignment', {
  surveyId,
  acName,
  target,
  currentCount,
  deficit,
  interviewerId
});
```

---

## 9. Migration Strategy

### Phase 1: Add Schema (No Breaking Changes)
- Add `acTargets` field to Survey model (optional, empty by default)
- Existing surveys continue working (no targets = priority-based)

### Phase 2: Add Helper Functions
- Create `acTargetCountHelper.js`
- Test counting logic

### Phase 3: Modify Assignment Logic
- Add target check in `startCatiInterview()`
- Test with one survey first

### Phase 4: Add Refill Logic
- Add refill on rejection
- Test refill queue

### Phase 5: Add Management UI
- Create endpoints for setting targets
- Add frontend UI

---

## 10. Testing Strategy

### 10.1 Unit Tests

- Test AC count calculation
- Test target deficit calculation
- Test refill job creation

### 10.2 Integration Tests

- Test assignment with targets
- Test refill on rejection
- Test multiple interviewers

### 10.3 Load Tests

- Test with 1000+ responses
- Test refill queue performance
- Test concurrent assignments

---

## 11. Security Considerations

1. **Authorization:** Only Company Admin/Project Manager can set targets
2. **Validation:** Validate AC names exist in assemblyConstituencies.json
3. **Audit Trail:** Log all target changes
4. **Rate Limiting:** Limit refill job creation

---

## 12. Benefits of This Design

✅ **Non-Breaking:** Existing functionality unchanged  
✅ **Efficient:** Uses aggregation and caching  
✅ **Scalable:** Queue-based refill processing  
✅ **Flexible:** Can enable/disable per AC  
✅ **Maintainable:** Clear separation of concerns  
✅ **Performant:** Redis caching, batch processing  

---

## 13. Implementation Checklist

- [ ] Add `acTargets` field to Survey model
- [ ] Create `acTargetCountHelper.js`
- [ ] Modify `startCatiInterview()` for target-based selection
- [ ] Add refill logic to `submitVerification()`
- [ ] Create refill queue and worker
- [ ] Add API endpoints for target management
- [ ] Add frontend UI for setting targets
- [ ] Add monitoring and alerts
- [ ] Write tests
- [ ] Documentation

---

**Document Version:** 1.0  
**Status:** Design Complete - Ready for Review  
**Next Step:** Review and approve before implementation














