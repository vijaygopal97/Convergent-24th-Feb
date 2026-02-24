# 💳 Razorpay Setup Guide: Fund Source & Account Configuration

## 🔍 Understanding How Razorpay Payouts Work

---

## 📊 Two Options for Razorpay Payouts

Razorpay offers **two ways** to handle payouts:

### **Option 1: RazorpayX Current Account** (Recommended) ✅

**What is RazorpayX?**
- It's like opening a **business bank account** with Razorpay
- You get a virtual current account number
- You transfer money TO this account first
- Then Razorpay distributes it to your interviewers

**How it works:**
```
Your Company Bank Account → Transfer Money → RazorpayX Account → Distribute to Interviewers
```

**Advantages:**
- ✅ Better control over funds
- ✅ Can maintain balance in RazorpayX account
- ✅ Faster payouts (money already in RazorpayX)
- ✅ Better for bulk payouts

---

### **Option 2: Razorpay Payouts (Direct Bank Account)** 

**What is it?**
- Uses your **existing company bank account**
- Razorpay debits money directly from your bank account
- No need for separate RazorpayX account

**How it works:**
```
Your Company Bank Account → Razorpay Debits → Distribute to Interviewers
```

**Advantages:**
- ✅ No need to transfer money separately
- ✅ Simpler setup
- ✅ Direct from your account

**Disadvantages:**
- ⚠️ Requires sufficient balance in your account
- ⚠️ Slightly slower (needs to debit first)

---

## 🎯 Recommended: RazorpayX Current Account

For automated monthly payroll, **RazorpayX is better** because:
1. You can transfer money once a month to RazorpayX
2. Then all payouts happen instantly
3. Better for bulk processing
4. More control

---

## 📋 What Details You Need to Provide to Razorpay

### **Step 1: Business Registration**

**Documents Required:**
1. **Company Registration Certificate**
   - If Private Limited: Certificate of Incorporation
   - If Partnership: Partnership Deed
   - If LLP: LLP Agreement

2. **PAN Card** (Company PAN)
   - Permanent Account Number of your company

3. **GST Certificate** (if applicable)
   - GST Registration Certificate
   - GSTIN Number

4. **Address Proof**
   - Company registered address proof
   - Utility bill or rent agreement

5. **Bank Account Details** (Your Company's Bank Account)
   - Bank Account Number
   - IFSC Code
   - Bank Name
   - Account Holder Name (Company Name)
   - Account Type (Current/Savings)
   - Cancelled Cheque or Bank Statement

6. **Authorized Signatory Details**
   - Name, PAN, Aadhaar, Phone, Email
   - Photo ID (Aadhaar/Passport/Driving License)

---

### **Step 2: RazorpayX Account Setup** (If using Option 1)

**What Razorpay Creates:**
- A **virtual current account** for your company
- You get an account number (like: `2323230000123456`)
- This is where you transfer money

**What You Do:**
1. **Transfer Money to RazorpayX Account**
   - From your company bank account
   - Transfer via NEFT/RTGS/IMPS
   - Use the RazorpayX account number provided
   - Keep sufficient balance for payouts

2. **Add Beneficiaries** (Your Interviewers)
   - Add each interviewer's bank details
   - Account Number, IFSC, Account Holder Name
   - Razorpay verifies these details

---

### **Step 3: API Keys Setup**

**What Razorpay Provides:**
1. **Key ID**: `rzp_test_xxxxxxxxxxxxx` (test) or `rzp_live_xxxxxxxxxxxxx` (production)
2. **Key Secret**: `your_secret_key_here`
3. **Webhook Secret**: `your_webhook_secret_here` (for payment status updates)

**Where to Find:**
- Login to Razorpay Dashboard
- Go to Settings → API Keys
- Generate new keys or use existing ones

---

## 💰 Money Flow Explanation

### **Scenario: Paying 100 Interviewers ₹5,000 each = ₹5,00,000 total**

### **With RazorpayX (Option 1):**

```
Day 1: You transfer ₹5,00,000 to RazorpayX account
       ↓
Day 2: System triggers payment API
       ↓
RazorpayX Account: ₹5,00,000 available
       ↓
Razorpay distributes:
  - Interviewer 1: ₹5,000 → Their Bank Account
  - Interviewer 2: ₹5,000 → Their Bank Account
  - ... (all 100 interviewers)
       ↓
RazorpayX Account: ₹0 remaining
```

### **With Direct Bank Account (Option 2):**

```
Day 1: System triggers payment API
       ↓
Your Company Bank Account: ₹5,00,000 available
       ↓
Razorpay debits ₹5,00,000 from your account
       ↓
Razorpay distributes:
  - Interviewer 1: ₹5,000 → Their Bank Account
  - Interviewer 2: ₹5,000 → Their Bank Account
  - ... (all 100 interviewers)
       ↓
Your Company Bank Account: ₹0 deducted
```

---

## 🔧 Setup Process Step-by-Step

### **Phase 1: Razorpay Account Creation**

1. **Sign Up**
   - Go to https://razorpay.com/
   - Click "Sign Up" → Choose "Business Account"
   - Enter company email, phone, company name

2. **Complete KYC**
   - Upload all documents mentioned above
   - Wait for verification (1-3 business days)
   - Razorpay team will review and approve

3. **Choose Product**
   - **RazorpayX**: For current account + payouts
   - **Razorpay Payouts**: For direct bank account payouts

---

### **Phase 2: RazorpayX Account Setup** (If using Option 1)

1. **Open RazorpayX Account**
   - In Razorpay Dashboard → Go to "RazorpayX"
   - Click "Open Current Account"
   - Complete additional verification

2. **Get Your RazorpayX Account Number**
   - You'll receive: `2323230000123456` (example)
   - Note this account number

3. **Add Money to RazorpayX**
   - Transfer from your company bank account
   - Use NEFT/RTGS/IMPS
   - Transfer amount needed for payouts
   - Example: Transfer ₹10,00,000 for monthly payroll

---

### **Phase 3: Add Beneficiaries** (Interviewers)

**Method 1: Via Razorpay Dashboard (Manual)**
1. Go to RazorpayX → Contacts/Beneficiaries
2. Click "Add Contact"
3. Enter:
   - Account Number
   - IFSC Code
   - Account Holder Name
   - Contact Name (Interviewer Name)
4. Razorpay verifies account
5. Repeat for all interviewers

**Method 2: Via API (Automated)** ✅ Recommended
- Use Razorpay API to add beneficiaries programmatically
- We'll implement this in the code

---

### **Phase 4: Get API Keys**

1. **Login to Razorpay Dashboard**
2. **Go to Settings → API Keys**
3. **Generate Keys:**
   - Test Mode: For testing (use test keys)
   - Live Mode: For production (use live keys)
4. **Copy:**
   - Key ID
   - Key Secret
   - Webhook Secret (generate separately)

---

### **Phase 5: Configure in Your System**

Add to `/var/www/opine/backend/.env`:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_live_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
RAZORPAY_MODE=live

# RazorpayX Account (if using Option 1)
RAZORPAYX_ACCOUNT_NUMBER=2323230000123456

# OR Direct Bank Account (if using Option 2)
RAZORPAY_BANK_ACCOUNT_NUMBER=your_company_account_number
RAZORPAY_BANK_IFSC=your_company_ifsc_code
```

---

## 💵 Cost Structure

### **Razorpay Fees:**

1. **Account Setup**: FREE
2. **RazorpayX Account**: FREE (no monthly charges)
3. **Payout Fees:**
   - **IMPS (Instant)**: ₹2-5 per transaction
   - **NEFT (Standard)**: ₹2-5 per transaction
   - **RTGS (Large amounts)**: ₹25-50 per transaction

### **Example Monthly Cost:**

- **100 Interviewers**: 100 × ₹5 = **₹500/month**
- **500 Interviewers**: 500 × ₹5 = **₹2,500/month**

**Much cheaper than manual bank transfers!**

---

## 🔐 Security & Compliance

### **What Razorpay Handles:**
- ✅ Bank account verification
- ✅ IFSC code validation
- ✅ Transaction security
- ✅ Compliance with RBI regulations
- ✅ TDS reporting (if applicable)

### **What You Need to Handle:**
- ✅ Maintain sufficient balance
- ✅ Keep beneficiary details updated
- ✅ Monitor failed transactions
- ✅ Handle TDS calculations (if applicable)

---

## 📞 Support & Documentation

### **Razorpay Resources:**
- **Dashboard**: https://dashboard.razorpay.com/
- **Documentation**: https://razorpay.com/docs/payouts/
- **Support**: support@razorpay.com or +91-XXXXXXXXXX
- **API Reference**: https://razorpay.com/docs/api/payouts/

---

## ✅ Checklist: What You Need Before Starting

- [ ] Company registration documents
- [ ] Company PAN card
- [ ] GST certificate (if applicable)
- [ ] Company bank account details
- [ ] Authorized signatory details (PAN, Aadhaar, ID proof)
- [ ] Company address proof
- [ ] Decide: RazorpayX or Direct Bank Account
- [ ] List of interviewer bank details (for adding beneficiaries)

---

## 🚀 Next Steps

1. **Sign Up**: Create Razorpay business account
2. **Complete KYC**: Submit all documents
3. **Choose Option**: RazorpayX (recommended) or Direct Bank Account
4. **Get API Keys**: Generate from dashboard
5. **Add Money**: Transfer to RazorpayX (if using Option 1)
6. **Add Beneficiaries**: Add interviewer bank details
7. **Integrate**: Use API keys in your system
8. **Test**: Test with small amount first
9. **Go Live**: Enable automated monthly payments

---

## 💡 Pro Tips

1. **Start with Test Mode**: Test everything with test API keys first
2. **Small Batch First**: Test with 5-10 interviewers before full rollout
3. **Monitor Balance**: Keep sufficient balance in RazorpayX account
4. **Set Alerts**: Configure low balance alerts
5. **Reconciliation**: Daily reconciliation of payments
6. **Backup Plan**: Keep manual transfer option as backup

---

**This guide covers everything you need to know about Razorpay setup and fund management!**





































