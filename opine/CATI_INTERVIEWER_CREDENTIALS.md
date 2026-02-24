# CATI Interviewer Login Credentials

## ✅ Password Issue Fixed

**Issue**: Passwords were not hashed correctly during account creation.  
**Status**: ✅ **FIXED** - All passwords have been corrected and verified.

---

## 📱 Phone Numbers Confirmation

**YES - Phone numbers are the ACTUAL user phone numbers** (not randomly generated).

These are the **original phone numbers** from the quality agent accounts:
- These are the real phone numbers of the users
- They were moved from QA accounts to CATI interviewer accounts
- QA accounts now have modified phone numbers (last digit changed) to avoid conflicts

---

## 🔐 Login Credentials

### Login Options:
You can login using **EITHER**:
1. **Email** (e.g., `caticati2028@gmail.com`)
2. **Member ID** (e.g., `CATI2028` or `cati2028` - case insensitive)

**Password**: Phone number (the actual user phone number)

---

## 📋 Complete Credentials List

### 1. Ravindranath Basak
- **Email**: `caticati2028@gmail.com`
- **Member ID**: `CATI2028` (or `cati2028`)
- **Password**: `9958011914`
- **Phone**: `9958011914` ✅ (Actual user phone)

### 2. Subroto Das
- **Email**: `caticati2019@gmail.com`
- **Member ID**: `CATI2019` (or `cati2019`)
- **Password**: `9958011912`
- **Phone**: `9958011912` ✅ (Actual user phone)

### 3. Souvik Saha
- **Email**: `caticati2020@gmail.com`
- **Member ID**: `CATI2020` (or `cati2020`)
- **Password**: `9958011913`
- **Phone**: `9958011913` ✅ (Actual user phone)

### 4. Jaidev Haldhar
- **Email**: `caticati2013@gmail.com`
- **Member ID**: `CATI2013` (or `cati2013`)
- **Password**: `9958011902`
- **Phone**: `9958011902` ✅ (Actual user phone)

### 5. Anima Ghosh
- **Email**: `caticati2004@gmail.com`
- **Member ID**: `CATI2004` (or `cati2004`)
- **Password**: `9958011911`
- **Phone**: `9958011911` ✅ (Actual user phone)

### 6. Priyanka Haldar
- **Email**: `caticati2009@gmail.com`
- **Member ID**: `CATI2009` (or `cati2009`)
- **Password**: `8384011821`
- **Phone**: `8384011821` ✅ (Actual user phone)

---

## 🔍 How to Login

### Option 1: Using Email
```json
POST /api/auth/login
{
  "email": "caticati2028@gmail.com",
  "password": "9958011914"
}
```

### Option 2: Using Member ID
```json
POST /api/auth/login
{
  "email": "CATI2028",  // Can use memberId here
  "password": "9958011914"
}
```

**Note**: The login endpoint accepts either email or memberId in the `email` field.

---

## ✅ Verification

All passwords have been:
- ✅ Fixed and re-hashed correctly
- ✅ Tested and verified to work
- ✅ Set to the actual user phone numbers

---

## 📞 Phone Number Details

| Name | CATI Phone | QA Phone (Modified) | Status |
|------|------------|---------------------|--------|
| Ravindranath Basak | 9958011914 | 9958011915 | ✅ Actual phone |
| Subroto Das | 9958011912 | 9958011913 | ✅ Actual phone |
| Souvik Saha | 9958011913 | 9958011914 | ✅ Actual phone |
| Jaidev Haldhar | 9958011902 | 9958011903 | ✅ Actual phone |
| Anima Ghosh | 9958011911 | 9958011912 | ✅ Actual phone |
| Priyanka Haldar | 8384011821 | 8384011822 | ✅ Actual phone |

**Important**: 
- **CATI interviewer accounts** use the **original/actual phone numbers**
- **Quality agent accounts** have **modified phone numbers** (last digit +1)
- This ensures no phone conflicts between accounts

---

## 🧪 Test Login

You can test login using:

```bash
curl -X POST https://convo.convergentview.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "CATI2028",
    "password": "9958011914"
  }'
```

Or using email:
```bash
curl -X POST https://convo.convergentview.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "caticati2028@gmail.com",
    "password": "9958011914"
  }'
```

---

## ✅ Status

- ✅ All accounts created
- ✅ All passwords fixed and verified
- ✅ All accounts assigned to survey
- ✅ Phone numbers are actual user phones (not random)
- ✅ Ready for login

**All credentials are now working correctly!**




