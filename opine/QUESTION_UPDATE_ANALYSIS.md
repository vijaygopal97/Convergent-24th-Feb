# Question Update Analysis Report

## Question Details

**Question ID**: `question_1767953047865_319`  
**Survey ID**: `68fd1915d41841da463f0d46`  
**Question Text**: "Locality Type? {এলাকার ধরন?{इलाके का प्रकार?}}"  
**Question Type**: `multiple_choice` (single selection)  
**Enabled For**: Both CAPI and CATI

### Question Options:
1. **Urban** 
   - Value: `urban_{শহুরে?{शहरी}}`
   - Code: `1`
   - Option ID: `question_1767953047865_319_opt_1`

2. **Rural**
   - Value: `rural_{গ্রামীণ{ग्रामीण}}`
   - Code: `2`
   - Option ID: `question_1767953047865_319_opt_2`

---

## How Responses Are Stored

Responses are stored in the `SurveyResponse` model in the `responses[]` array. Each response object contains:

```javascript
{
  sectionIndex: Number,
  questionIndex: Number,
  questionId: String,        // "question_1767953047865_319"
  questionType: String,      // "multiple_choice"
  questionText: String,
  questionDescription: String,
  questionOptions: [String],
  response: Mixed,           // The selected value or array of values
  responseCodes: Mixed,      // The code(s) - "1" or "2" or ["1", "2"]
  responseWithCodes: Mixed,  // Structured response with codes
  responseTime: Number,
  isRequired: Boolean,
  isSkipped: Boolean
}
```

For a `multiple_choice` question with single selection:
- `response`: The selected option value (e.g., `"urban_{শহুরে?{शहरी}}"`)
- `responseCodes`: The selected option code (e.g., `"1"` or `1`)
- `responseWithCodes`: Structured object with code, answer, and optionText

---

## CSV Data Analysis

**CSV File**: `/var/www/reports/output_with_partno (2).csv`  
**Total Rows**: 15,944 (including header)

### Analysis Results:

| Category | Count | Percentage |
|----------|-------|------------|
| **Total responses in CSV** | 15,944 | 100% |
| **Already have question** | 1,707 | 10.7% |
| **Need update** | 14,237 | 89.3% |
| | | |
| **Breakdown of responses needing update:** | | |
| - Urban | 4,128 | 25.9% |
| - Rural | 7,438 | 46.7% |
| - Rural (Not sure) | 120 | 0.8% |
| - Not Found | 2,547 | 16.0% |
| - Unknown types | 4 | 0.0% |

---

## Update Logic

### ✅ Responses That WILL Be Updated: **11,686**

1. **Urban** (4,128 responses)
   - Add question with response: `"urban_{শহুরে?{शहरी}}"`
   - Response code: `"1"`

2. **Rural** (7,438 responses)
   - Add question with response: `"rural_{গ্রামীণ{ग्रामीण}}"`
   - Response code: `"2"`

3. **Rural (Not sure)** (120 responses)
   - Add question with response: `"rural_{গ্রামীণ{ग्रामीण}}"` (set to Rural)
   - Response code: `"2"`

### ❌ Responses That Will Be SKIPPED: **2,551**

1. **Not Found** (2,547 responses)
   - Will NOT add the question (as per your instruction)

2. **Unknown types** (4 responses)
   - Will NOT add the question (safety measure)

### ✅ Responses That Will Be IGNORED: **1,707**

- Already have the question - no changes needed

---

## Implementation Plan

### Safety Measures:

1. **Check Before Adding**: 
   - Verify response doesn't already have this question
   - Only add if question is missing

2. **Preserve Existing Data**:
   - Only add to `responses[]` array
   - No modification of existing responses
   - No changes to other fields (status, metadata, etc.)

3. **Question Details**:
   - Need to find the question in the survey to get:
     - `sectionIndex` and `questionIndex` (where question appears in survey)
     - `questionText`, `questionDescription`, `questionOptions`
   - These will be extracted from the survey document

4. **Response Format**:
   - For Urban: `response = "urban_{শহুরে?{शहरी}}"`, `responseCodes = "1"`
   - For Rural: `response = "rural_{গ্রামীণ{ग्रामीण}}"`, `responseCodes = "2"`
   - `responseWithCodes` will be structured object with code, answer, and optionText

5. **Transaction Safety**:
   - Use MongoDB `updateOne` with `$push` to add to array
   - Atomic operation - no risk of partial updates
   - Can be done in batches for performance

---

## Can This Be Done Safely?

### ✅ YES - This can be done without affecting anything else:

1. **Atomic Operations**: Using `$push` to add to array is atomic - either succeeds or fails completely
2. **No Data Loss**: We're only adding, never modifying or deleting
3. **Idempotent**: Can be run multiple times safely (checks if question exists first)
4. **Isolated**: Only affects the `responses[]` array, no other fields touched
5. **Reversible**: Can be undone by removing the question from responses if needed

### Implementation Approach:

```javascript
// Pseudo-code
for each responseId in CSV:
  1. Find response in database
  2. Check if question already exists → Skip if yes
  3. Get locality type from CSV
  4. If locality type is "Urban" or "Rural" or "Rural (Not sure)":
     - Find question details from survey (sectionIndex, questionIndex, etc.)
     - Create response object with correct format
     - Use $push to add to responses array
  5. If locality type is "Not Found" or unknown → Skip
```

---

## Summary

- **Total responses to update**: 11,686
- **Total responses to skip**: 2,551 (Not Found + Unknown)
- **Total responses already have question**: 1,707 (will be ignored)

**This operation is SAFE and can be performed without affecting any existing data.**

The update will:
- ✅ Only add new question responses
- ✅ Never modify existing responses
- ✅ Never change other fields (status, metadata, etc.)
- ✅ Be atomic (all-or-nothing per response)
- ✅ Be idempotent (can be run multiple times safely)

---

## Next Steps

Once you approve, I will:
1. Create a script that reads the CSV
2. For each response, check if question exists
3. If missing and locality type is valid, add the question response
4. Use proper MongoDB operations to ensure data integrity
5. Generate a detailed report of what was updated

**Ready to proceed when you give approval!**





