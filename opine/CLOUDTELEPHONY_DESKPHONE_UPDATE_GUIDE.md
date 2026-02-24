# CloudTelephony Deskphone Number Update Guide

## Current Status

**Current Deskphone Number:** `917316525610`

**Issue:** CloudTelephony calls are failing with error: `"No Callgroup is available for this Account"`

This error indicates that the CloudTelephony account needs to have a callgroup configured in their system. This is an account-level configuration issue with CloudTelephony, not a code issue.

## All Locations Where Deskphone Number Needs to be Updated

### 1. PRIMARY: Environment Variable (.env file)
**Location:** `/var/www/opine/backend/.env`
**Current Value:** `CLOUDTELEPHONY_DESKPHONE=917316525610`
**Action Required:** Update this value to the new deskphone number

**Note:** There are backup .env files with old values:
- `.env.backup-20260117-002939`: `00917316920859`
- `.env.backup.1768610255`: `00917316920859`
- `.env.backup.20260116_225458`: `00917316920859`

### 2. CODE: Default Fallback Value
**Location:** `/var/www/opine/backend/services/catiProviders/cloudtelephonyProvider.js`
**Line:** 30
**Current Code:**
```javascript
let deskphone = config.deskphone || process.env.CLOUDTELEPHONY_DESKPHONE || '917316525610';
```
**Action Required:** Update the fallback value `'917316525610'` to the new number

### 3. CODE: Old Number Detection Logic
**Location:** `/var/www/opine/backend/services/catiProviders/cloudtelephonyProvider.js`
**Lines:** 35-40
**Current Code:**
```javascript
if (cleanDeskphone === '917316525609' || cleanDeskphone === '17316525609' || 
    cleanDeskphone === '917316525608' || cleanDeskphone === '17316525608') {
  // This is an old number - force use of new number
  deskphone = '917316525610';
  console.log(`⚠️ [CloudTelephony] Old deskphone number detected, forcing use of new number: ${deskphone}`);
}
```
**Action Required:** 
- Update the forced value `'917316525610'` to the new number
- Optionally add the current number (`917316525610`) to the old number detection list

### 4. TEST SCRIPT (No Change Needed)
**Location:** `/var/www/opine/backend/scripts/test-cloudtelephony-call-timing.js`
**Line:** 32
**Status:** Uses `process.env.CLOUDTELEPHONY_DESKPHONE` - no code change needed

## Update Steps (Once New Number is Provided)

1. **Update .env file:**
   ```bash
   cd /var/www/opine/backend
   # Edit .env and change:
   CLOUDTELEPHONY_DESKPHONE=<NEW_NUMBER>
   ```

2. **Update cloudtelephonyProvider.js:**
   - Line 30: Change fallback value
   - Line 38: Change forced value in old number detection

3. **Restart Services:**
   ```bash
   pm2 restart opine-backend
   pm2 restart opine-cati-call-worker
   ```

4. **Verify:**
   - Check logs: `pm2 logs opine-cati-call-worker`
   - Test a call to ensure new deskphone is being used

## Current Provider Configuration

- **Active Provider:** DeepCall (switched due to CloudTelephony callgroup issue)
- **Fallback Provider:** CloudTelephony
- **Enabled Providers:** ['deepcall', 'cloudtelephony']

## Important Notes

1. **Callgroup Issue:** The "No Callgroup is available for this Account" error must be resolved with CloudTelephony support. Changing the deskphone number alone may not fix this if the account doesn't have a callgroup configured.

2. **Number Format:** The code expects the number WITHOUT "00" prefix. Use format like `917316525610` (not `00917316525610`).

3. **Old Number Detection:** The code automatically detects and replaces old numbers (`917316525609`, `917316525608`, etc.) with the current number. You may want to add `917316525610` to this list once you update to the new number.

## Ready for Update

Once you provide the new deskphone number, I will:
1. Update the .env file
2. Update the code in cloudtelephonyProvider.js
3. Restart the necessary services
4. Verify the changes are working



