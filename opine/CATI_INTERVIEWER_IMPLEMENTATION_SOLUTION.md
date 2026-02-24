# Solution: Creating CATI Interviewers with CATI Prefix from Quality Agents

## ✅ Database & Backend Analysis Results

### Database Schema Validation
- **memberId validation**: `/^[A-Za-z0-9]+$/` - **ALLOWS alphanumeric** ✅
- **Format**: Can be "CATI1102", "CATI2009", "1102", "2009" - **ALL VALID** ✅
- **Uniqueness**: `unique: true, sparse: true` - Must be unique if set ✅

### Current CATI Interviewer Format
- **Existing format**: Numeric only (e.g., "1", "1000", "10001", "10002")
- **No CATI prefix currently used**: 0 interviewers with CATI prefix

### Backend Validation Issue ⚠️

**Problem Found**: The project manager endpoint has **strict validation** that blocks CATI prefix:

```javascript
// In authController.js - addInterviewerByProjectManager
if (interviewerType === 'CATI') {
  // CATI must be numeric, max 5 digits
  if (!/^\d+$/.test(finalMemberId)) {
    return res.status(400).json({
      success: false,
      message: 'CATI Interviewer ID must be numeric (up to 5 digits)'
    });
  }
}
```

**This means**: 
- ❌ Cannot use "CATI1102" format through project manager UI
- ✅ Can use "CATI1102" format via direct database/script creation
- ✅ Database schema allows it

---

## 🎯 Solution Options

### ✅ **Option 1: Modify Project Manager Validation (RECOMMENDED)**

**Approach**: Update the validation to allow CATI prefix for CATI interviewers

**Changes Needed**:
1. Modify `authController.js` - `addInterviewerByProjectManager` function
2. Allow CATI prefix format: `CATI` + numbers (e.g., "CATI1102", "CATI2009")
3. Keep backward compatibility with numeric-only format

**Code Change**:
```javascript
// Current (line ~2211):
if (!/^\d+$/.test(finalMemberId)) {
  return res.status(400).json({
    success: false,
    message: 'CATI Interviewer ID must be numeric (up to 5 digits)'
  });
}

// New (allow CATI prefix):
const catiPattern = /^(CATI)?\d{1,5}$/i; // Allow "CATI1102" or "1102"
if (!catiPattern.test(finalMemberId)) {
  return res.status(400).json({
    success: false,
    message: 'CATI Interviewer ID must be numeric (1-5 digits) or CATI prefix format (CATI + 1-5 digits)'
  });
}

// Normalize: If numeric only, keep as-is. If has CATI prefix, use as-is.
// If user provides "1102" but wants "CATI1102", we can add prefix
if (!finalMemberId.toUpperCase().startsWith('CATI')) {
  // Optional: Auto-add CATI prefix if not present
  // finalMemberId = `CATI${finalMemberId}`;
}
```

**Pros**:
- ✅ Works through project manager UI
- ✅ Backward compatible (still accepts numeric)
- ✅ Consistent with CAPI format (CAPI12345)

**Cons**:
- ⚠️ Requires code change
- ⚠️ Need to test thoroughly

---

### **Option 2: Direct Script Creation (Bypass Project Manager)**

**Approach**: Create interviewer accounts directly via script, bypassing project manager validation

**Implementation**:
- Create script that directly creates User documents
- Use "CATI" + QA-cati-ID as memberId
- Assign to surveys manually

**Pros**:
- ✅ No code changes needed
- ✅ Can use any memberId format
- ✅ Full control

**Cons**:
- ⚠️ Bypasses project manager workflow
- ⚠️ Need to manually assign to surveys

---

### **Option 3: Use Numeric MemberIds (Current Format)**

**Approach**: Use numeric memberIds (like existing CATI interviewers) but link to quality agents

**Implementation**:
- Create interviewer with numeric memberId (e.g., "1102", "2009")
- Link to quality agent account
- Use same number from QA-cati-ID

**Pros**:
- ✅ No code changes needed
- ✅ Works with existing project manager flow
- ✅ Matches current format

**Cons**:
- ⚠️ Doesn't use CATI prefix (as requested)

---

## 📋 **Recommended Implementation: Option 1 + Script**

### Phase 1: Update Validation (Allow CATI Prefix)

**File**: `/var/www/opine/backend/controllers/authController.js`

**Change**: Lines ~2210-2224

**New Validation Logic**:
```javascript
} else {
  // CATI: Allow numeric OR CATI prefix format
  // Format: "1102" or "CATI1102" (CATI + 1-5 digits)
  const catiPattern = /^(CATI)?\d{1,5}$/i;
  
  if (!catiPattern.test(finalMemberId)) {
    return res.status(400).json({
      success: false,
      message: 'CATI Interviewer ID must be numeric (1-5 digits) or CATI prefix format (CATI + 1-5 digits). Examples: "1102" or "CATI1102"'
    });
  }
  
  // Normalize to uppercase if has CATI prefix
  if (finalMemberId.toUpperCase().startsWith('CATI')) {
    finalMemberId = finalMemberId.toUpperCase();
    // Extract numeric part for length check
    const numericPart = finalMemberId.replace(/^CATI/i, '');
    if (numericPart.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'CATI Interviewer ID can only have up to 5 digits after "CATI" prefix'
      });
    }
  } else {
    // Numeric only - check length
    if (finalMemberId.length > 5) {
      return res.status(400).json({
        success: false,
        message: 'CATI Interviewer ID can only have up to 5 digits'
      });
    }
  }
}
```

### Phase 2: Create Interviewer Accounts Script

**Script**: Create interviewer accounts for quality agents with CATI prefix

**Logic**:
1. Find quality agents with `'QA-cati-ID'` field
2. For each QA:
   - Use `'QA-cati-ID'` value (e.g., "2009")
   - Create memberId: `CATI` + QA-cati-ID (e.g., "CATI2009")
   - Create interviewer account
   - Link accounts (optional)
   - Assign to default survey

**MemberId Format**:
- If QA has `'QA-cati-ID': '2009'` → Interviewer gets `memberId: 'CATI2009'`
- If QA has `'QA-cati-ID': '1102'` → Interviewer gets `memberId: 'CATI1102'`

### Phase 3: Assign to Default Survey

**Default Survey**: `68fd1915d41841da463f0d46` (West Bengal Opinion Poll)

**Assignment Process** (same as project manager does):
```javascript
survey.catiInterviewers.push({
  interviewer: newInterviewer._id,
  assignedBy: companyAdmin._id,
  assignedAt: new Date(),
  status: 'assigned',
  maxInterviews: 0,
  completedInterviews: 0
});
```

---

## 🔍 **Current Project Manager Flow**

When project manager adds CATI interviewer:

1. **Endpoint**: `POST /api/auth/project-manager/add-interviewer`
2. **Body**:
   ```json
   {
     "interviewerType": "CATI",
     "interviewerId": "1102",  // Currently must be numeric
     "firstName": "John",
     "lastName": "Doe",
     "phone": "9876543210",
     "password": "password123",
     "catiSurveyIds": ["68fd1915d41841da463f0d46"]  // Survey IDs to assign
   }
   ```

3. **Process**:
   - Validates memberId (currently numeric only)
   - Creates User with `userType: 'interviewer'`, `interviewModes: 'CATI (Telephonic interview)'`
   - Generates email: `cati{memberId}@gmail.com`
   - Assigns to surveys in `catiSurveyIds` array
   - Adds to `survey.catiInterviewers[]` with status 'assigned'

4. **Survey Assignment**:
   ```javascript
   survey.catiInterviewers.push({
     interviewer: newInterviewer._id,
     assignedBy: projectManager._id,
     assignedAt: new Date(),
     status: 'assigned',
     maxInterviews: 0,
     completedInterviews: 0
   });
   ```

---

## ✅ **Final Recommendation**

### **Use Option 1: Modify Validation + Create Script**

1. **Update validation** to allow CATI prefix format
2. **Create script** to:
   - Find quality agents with `'QA-cati-ID'`
   - Create interviewer accounts with `memberId: 'CATI' + QA-cati-ID`
   - Assign to default survey `68fd1915d41841da463f0d46`
   - Link accounts (optional)

3. **Benefits**:
   - ✅ Uses CATI prefix as requested
   - ✅ Works with project manager UI (after validation update)
   - ✅ Follows same assignment pattern
   - ✅ Can be done via script immediately (bypasses validation)

---

## 📝 **Implementation Plan**

### Step 1: Create Script (Can do immediately)
- Bypass project manager validation
- Create interviewer accounts directly
- Use CATI prefix format
- Assign to default survey

### Step 2: Update Validation (Optional, for future use)
- Modify `authController.js`
- Allow CATI prefix in project manager UI
- Test thoroughly

---

## ❓ **Questions to Confirm**

1. **Which quality agents?**
   - All with `'QA-cati-ID'` field? (I found 10+ already)
   - Or specific list?

2. **Default survey assignment?**
   - Should we auto-assign to `68fd1915d41841da463f0d46`?
   - Or specific survey IDs?

3. **Email format?**
   - `cati{CATI2009}@gmail.com` (e.g., `catiCATI2009@gmail.com`)?
   - Or `cati2009@gmail.com` (use numeric part only)?

4. **Password?**
   - Same as quality agent account?
   - Or phone number?
   - Or generate new?

5. **Account linking?**
   - Add `linkedQualityAgent` and `linkedInterviewer` fields?
   - Or just create separate accounts?

---

**Ready to implement once you confirm the details!**




