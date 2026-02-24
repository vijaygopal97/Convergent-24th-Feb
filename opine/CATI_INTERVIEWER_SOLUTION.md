# Solution: Adding CATI Interviewers Who Are Already Quality Agents

## Current Situation

- **Quality Agents** already have accounts with `userType: 'quality_agent'`
- They have `memberId` assigned to their quality agent accounts
- They need to also function as **CATI Interviewers**
- They want to use the same interviewer ID (like `CATI1102`) for both roles

## Current System Structure

### User Model Fields:
- `memberId`: Unique alphanumeric ID (e.g., "CATI004", "3585") - **UNIQUE constraint**
- `userType`: Single enum value (`'quality_agent'`, `'interviewer'`, etc.) - **NOT an array**
- `'QA-cati-ID'`: Field for quality agent CATI ID (optional, sparse)
- `'QA-capi-ID'`: Field for quality agent CAPI ID (optional, sparse)

### Current Limitations:
1. `userType` is a **single value**, not an array - can't be both `quality_agent` AND `interviewer`
2. `memberId` has **UNIQUE constraint** - can't have same memberId for two different users
3. System checks `userType === 'interviewer'` for interviewer operations

---

## Proposed Solutions

### ✅ **Solution 1: Create Separate Interviewer Accounts (RECOMMENDED)**

**Approach**: Create a new interviewer account linked to the quality agent account

**Implementation**:
1. Keep existing quality agent account as-is
2. Create new interviewer account with:
   - Same personal info (firstName, lastName, email, phone)
   - `userType: 'interviewer'`
   - `memberId: 'CATI1102'` (or similar format)
   - `interviewModes: 'CATI (Telephonic interview)'`
   - Link to quality agent via a new field: `linkedQualityAgent: ObjectId`

**Pros**:
- ✅ No schema changes required
- ✅ Clear separation of roles
- ✅ Can have different memberIds for each role
- ✅ Easy to query and manage
- ✅ No impact on existing code

**Cons**:
- ⚠️ Two separate accounts (but linked)
- ⚠️ Need to maintain consistency between accounts

**Schema Addition** (optional):
```javascript
// Add to User model
linkedQualityAgent: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  sparse: true
},
linkedInterviewer: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User',
  sparse: true
}
```

---

### **Solution 2: Use QA-cati-ID Field for Interviewer Operations**

**Approach**: Use existing `'QA-cati-ID'` field to store CATI interviewer ID

**Implementation**:
1. Keep quality agent account as-is
2. Set `'QA-cati-ID': 'CATI1102'` on quality agent account
3. Modify system to check `'QA-cati-ID'` when user is quality_agent but needs CATI access
4. Use `'QA-cati-ID'` as memberId for CATI operations

**Pros**:
- ✅ No new accounts needed
- ✅ Single account for both roles
- ✅ Uses existing field

**Cons**:
- ⚠️ Requires code changes in multiple places
- ⚠️ Logic becomes complex (check userType OR QA-cati-ID)
- ⚠️ May break existing queries that check `userType === 'interviewer'`

---

### **Solution 3: Modify userType to Support Multiple Roles**

**Approach**: Change `userType` from single value to array

**Implementation**:
1. Change schema: `userType: [String]` instead of `String`
2. Update all queries to use `$in` instead of `===`
3. Set `userType: ['quality_agent', 'interviewer']`
4. Use same memberId for both roles

**Pros**:
- ✅ Single account for both roles
- ✅ Cleaner data model
- ✅ No duplicate accounts

**Cons**:
- ❌ **MAJOR BREAKING CHANGE** - requires updating ALL queries
- ❌ High risk of breaking existing functionality
- ❌ Requires extensive testing
- ❌ May affect performance (indexes need updating)

---

### **Solution 4: Create Interviewer Account with Same memberId (NOT POSSIBLE)**

**Approach**: Try to use same memberId for both accounts

**Problem**: 
- ❌ `memberId` has UNIQUE constraint
- ❌ MongoDB will reject duplicate memberIds
- ❌ **This approach is NOT feasible**

---

## 🎯 **RECOMMENDED SOLUTION: Solution 1 (Separate Accounts with Linking)**

### Implementation Steps:

1. **Add Linking Fields to User Model** (optional but recommended):
   ```javascript
   linkedQualityAgent: {
     type: mongoose.Schema.Types.ObjectId,
     ref: 'User',
     sparse: true,
     index: true
   },
   linkedInterviewer: {
     type: mongoose.Schema.Types.ObjectId,
     ref: 'User',
     sparse: true,
     index: true
   }
   ```

2. **Create Interviewer Accounts**:
   - For each quality agent who needs CATI access:
     - Create new User document with:
       - `userType: 'interviewer'`
       - `memberId: 'CATI1102'` (format: CATI + number from QA memberId or sequential)
       - `interviewModes: 'CATI (Telephonic interview)'`
       - `linkedQualityAgent: <quality_agent_user_id>`
     - Update quality agent account:
       - `linkedInterviewer: <new_interviewer_user_id>`

3. **MemberId Format Options**:
   - **Option A**: Use QA memberId as base (e.g., QA has `2001`, interviewer gets `CATI2001`)
   - **Option B**: Use sequential CATI IDs (e.g., `CATI1102`, `CATI1103`, etc.)
   - **Option C**: Use QA-cati-ID if already set (e.g., if QA has `'QA-cati-ID': 'CATI1102'`, use that)

4. **Script to Create Interviewer Accounts**:
   ```javascript
   // Pseudo-code
   for each qualityAgent:
     if (qualityAgent['QA-cati-ID']) {
       memberId = qualityAgent['QA-cati-ID']
     } else {
       memberId = 'CATI' + qualityAgent.memberId
     }
     
     // Check if interviewer account already exists
     existingInterviewer = User.findOne({ memberId, userType: 'interviewer' })
     
     if (!existingInterviewer) {
       newInterviewer = createInterviewerAccount({
         ...qualityAgent.personalInfo,
         userType: 'interviewer',
         memberId: memberId,
         interviewModes: 'CATI (Telephonic interview)',
         linkedQualityAgent: qualityAgent._id
       })
       
       // Link back
       qualityAgent.linkedInterviewer = newInterviewer._id
       qualityAgent.save()
     }
   ```

---

## 📋 **Detailed Implementation Plan**

### Phase 1: Schema Update (Optional)
- Add `linkedQualityAgent` and `linkedInterviewer` fields
- Add indexes for performance

### Phase 2: Data Migration Script
- Identify quality agents who need CATI access
- Create interviewer accounts for them
- Link accounts bidirectionally
- Generate report of all changes

### Phase 3: Verification
- Verify interviewer accounts can start CATI interviews
- Verify quality agent accounts still work
- Test linking between accounts

### Phase 4: Assignment to Surveys
- Assign new interviewer accounts to CATI surveys
- Ensure they can access CATI queue

---

## **Questions to Answer Before Implementation:**

1. **Which quality agents need CATI access?**
   - Do you have a list of memberIds or emails?
   - Or should we check for existing `'QA-cati-ID'` field?

2. **MemberId Format Preference:**
   - Use `'QA-cati-ID'` if it exists?
   - Or generate new format like `CATI1102`?
   - Or use `CATI` + existing QA memberId?

3. **Email/Phone Handling:**
   - Same email for both accounts? (may need different emails)
   - Same phone number? (usually yes)

4. **Password:**
   - Same password for both accounts?
   - Or generate new password?

5. **Survey Assignment:**
   - Should we automatically assign them to specific surveys?
   - Or do it manually later?

---

## **Alternative: Hybrid Approach**

If you want to avoid creating separate accounts but still need interviewer functionality:

1. Keep quality agent account
2. Set `'QA-cati-ID': 'CATI1102'` 
3. Modify CATI interview start logic to:
   ```javascript
   // Check if user is interviewer OR quality_agent with QA-cati-ID
   const canStartCATI = 
     user.userType === 'interviewer' || 
     (user.userType === 'quality_agent' && user['QA-cati-ID'])
   
   // Use QA-cati-ID as memberId for CATI operations
   const catiMemberId = 
     user.userType === 'interviewer' ? user.memberId : user['QA-cati-ID']
   ```

This requires code changes but avoids duplicate accounts.

---

## **Recommendation**

**Use Solution 1 (Separate Accounts)** because:
- ✅ Cleanest separation of concerns
- ✅ No code changes required
- ✅ Easy to manage and query
- ✅ Can have different memberIds
- ✅ Minimal risk

**Next Steps:**
1. Provide list of quality agents who need CATI access
2. Specify memberId format preference
3. I'll create the migration script




