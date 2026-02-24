# 💰 Razorpay Money Flow: Simple Explanation

## 🎯 Quick Answer to Your Question

**Q: From where will the money be cut? Where will I set it up?**

**A: You have TWO options:**

---

## Option 1: RazorpayX Current Account (Recommended) ✅

### Setup:
1. **Open RazorpayX Account** → You get a virtual account number (like: `2323230000123456`)
2. **Transfer Money** → Transfer money FROM your company bank account TO RazorpayX account
3. **Razorpay Distributes** → Razorpay sends money from RazorpayX account to interviewers

### Visual Flow:
```
┌─────────────────────────┐
│ Your Company Bank       │
│ Account                 │
│ Balance: ₹10,00,000     │
└───────────┬─────────────┘
            │ Transfer ₹10,00,000
            │ (via NEFT/RTGS/IMPS)
            ↓
┌─────────────────────────┐
│ RazorpayX Account       │
│ Account: 2323230000123456│
│ Balance: ₹10,00,000     │ ← Money sits here
└───────────┬─────────────┘
            │ Razorpay distributes
            │ (via API call)
            ↓
    ┌───────┴───────┐
    │               │
    ↓               ↓
┌─────────┐    ┌─────────┐
│Interviewer│    │Interviewer│
│₹5,000   │    │₹5,000   │
│         │    │         │
│Bank A/c │    │Bank A/c │
└─────────┘    └─────────┘
```

### What You Provide to Razorpay:
- ✅ Your company bank account details (to transfer money TO RazorpayX)
- ✅ Company registration documents (for KYC)
- ✅ RazorpayX account number (you get this after opening account)

---

## Option 2: Direct Bank Account

### Setup:
1. **Link Your Bank Account** → Provide your company bank account details to Razorpay
2. **Razorpay Debits** → When you trigger payment, Razorpay debits directly from your account
3. **Razorpay Distributes** → Razorpay sends money to interviewers

### Visual Flow:
```
┌─────────────────────────┐
│ Your Company Bank       │
│ Account                 │
│ Balance: ₹10,00,000     │
└───────────┬─────────────┘
            │ Razorpay debits ₹10,00,000
            │ (when you trigger payment API)
            ↓
    ┌───────┴───────┐
    │               │
    ↓               ↓
┌─────────┐    ┌─────────┐
│Interviewer│    │Interviewer│
│₹5,000   │    │₹5,000   │
│         │    │         │
│Bank A/c │    │Bank A/c │
└─────────┘    └─────────┘
```

### What You Provide to Razorpay:
- ✅ Your company bank account details (for direct debit)
- ✅ Company registration documents (for KYC)
- ✅ Bank statement or cancelled cheque

---

## 📋 What Details Razorpay Needs From You

### 1. Company Information:
- Company Name
- Company PAN
- GST Number (if applicable)
- Registered Address
- Business Type (Private Limited, Partnership, etc.)

### 2. Bank Account Details:
- **Account Number**: Your company's bank account number
- **IFSC Code**: Your bank's IFSC code
- **Bank Name**: Name of your bank
- **Account Holder Name**: Your company name
- **Account Type**: Current or Savings
- **Proof**: Cancelled cheque or bank statement

### 3. Authorized Signatory:
- Name, PAN, Aadhaar, Phone, Email
- Photo ID proof

### 4. Documents:
- Company registration certificate
- PAN card copy
- GST certificate (if applicable)
- Address proof

---

## 💡 Which Option Should You Choose?

### Choose **RazorpayX** (Option 1) if:
- ✅ You want better control
- ✅ You want to transfer money once a month
- ✅ You're doing bulk payouts (100+ interviewers)
- ✅ You want faster payouts

### Choose **Direct Bank Account** (Option 2) if:
- ✅ You want simpler setup
- ✅ You don't want to transfer money separately
- ✅ You have fewer payouts (<50 interviewers)

---

## 🔧 Setup Process Summary

### For RazorpayX (Option 1):
1. Sign up for Razorpay → Complete KYC
2. Open RazorpayX Current Account → Get account number
3. Transfer money to RazorpayX account (from your bank)
4. Add interviewer bank details as beneficiaries
5. Use API to trigger payouts

### For Direct Bank Account (Option 2):
1. Sign up for Razorpay → Complete KYC
2. Link your company bank account
3. Add interviewer bank details as beneficiaries
4. Use API to trigger payouts (money debits automatically)

---

## 💵 Example: Paying 100 Interviewers ₹5,000 Each

### Total Amount Needed: ₹5,00,000

### With RazorpayX:
- **Step 1**: Transfer ₹5,00,000 to RazorpayX account (one-time)
- **Step 2**: System triggers API → Razorpay distributes ₹5,000 to each interviewer
- **Result**: All 100 interviewers receive ₹5,000 in their bank accounts

### With Direct Bank Account:
- **Step 1**: System triggers API → Razorpay debits ₹5,00,000 from your account
- **Step 2**: Razorpay distributes ₹5,000 to each interviewer
- **Result**: All 100 interviewers receive ₹5,000 in their bank accounts

---

## ✅ Summary

**Money Source:**
- **Option 1 (RazorpayX)**: Money comes from RazorpayX account (which you fund from your bank)
- **Option 2 (Direct)**: Money comes directly from your company bank account

**What You Set Up:**
- Your company bank account details
- RazorpayX account (if using Option 1)
- Interviewer bank details (beneficiaries)

**Razorpay Handles:**
- Bank transfers (NEFT/IMPS/RTGS)
- Account verification
- Transaction processing
- Compliance

---

**See `RAZORPAY_SETUP_GUIDE.md` for detailed step-by-step setup instructions!**





































