# 🚀 Quick Start: Automated Payroll Implementation Guide

## Step-by-Step Implementation

---

## Step 1: Set Up Razorpay Account

1. **Sign Up**: Go to https://razorpay.com/
2. **Choose Product**: 
   - **RazorpayX** (for business banking + payouts) OR
   - **Razorpay Payouts** (standalone payout API)
3. **Complete KYC**: Submit business documents
4. **Get API Keys**: 
   - Key ID: `rzp_test_...` (test) or `rzp_live_...` (production)
   - Key Secret: `...`
5. **Enable Payouts**: Contact Razorpay support to enable payout feature

---

## Step 2: Install Dependencies

```bash
cd /var/www/opine/backend
npm install razorpay node-cron
```

---

## Step 3: Environment Variables

Add to `/var/www/opine/backend/.env`:

```env
# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_secret_key_here
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret_here
RAZORPAY_MODE=test  # or 'live' for production

# RazorpayX Account (if using RazorpayX Current Account - Recommended)
RAZORPAYX_ACCOUNT_NUMBER=2323230000123456  # Your RazorpayX account number

# OR Direct Bank Account (if using Direct Bank Account option)
# RAZORPAY_BANK_ACCOUNT_NUMBER=your_company_account_number
# RAZORPAY_BANK_IFSC=your_company_ifsc_code

# Payment Configuration
PAYMENT_AUTO_APPROVE=false
PAYMENT_PAYOUT_DAY=1  # Day of month (1-31)
PAYMENT_PAYOUT_TIME=10:00  # IST time
PAYMENT_MIN_AMOUNT=100  # Minimum payment amount in INR
PAYMENT_TDS_RATE=10  # TDS percentage (10%)
```

**Important Notes:**
- **RazorpayX Account Number**: You get this after opening RazorpayX current account. This is where you transfer money first, then Razorpay distributes it.
- **OR Direct Bank Account**: If not using RazorpayX, Razorpay will debit directly from your company bank account.
- See `RAZORPAY_SETUP_GUIDE.md` for detailed setup instructions.

---

## Step 4: Create Database Models

Create `/var/www/opine/backend/models/PaymentTransaction.js`:

```javascript
const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  payoutId: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  memberId: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'INR'
  },
  paymentPeriod: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    month: { type: Number, required: true },
    year: { type: Number, required: true }
  },
  calculationBreakdown: {
    baseAmount: { type: Number, default: 0 },
    completedInterviews: { type: Number, default: 0 },
    approvedResponses: { type: Number, default: 0 },
    qualityBonus: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    tds: { type: Number, default: 0 },
    netAmount: { type: Number, required: true }
  },
  bankDetails: {
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true },
    bankName: { type: String, required: true },
    accountHolderName: { type: String, required: true }
  },
  status: {
    type: String,
    enum: ['pending', 'initiated', 'processing', 'success', 'failed', 'reversed', 'cancelled'],
    default: 'pending',
    index: true
  },
  gatewayResponse: {
    payoutId: String,
    status: String,
    utr: String,
    failureReason: String,
    processedAt: Date,
    rawResponse: mongoose.Schema.Types.Mixed
  },
  retryCount: {
    type: Number,
    default: 0
  },
  maxRetries: {
    type: Number,
    default: 3
  },
  nextRetryAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: Date,
  requiresApproval: {
    type: Boolean,
    default: true
  },
  notes: String,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true
});

paymentTransactionSchema.index({ user: 1, 'paymentPeriod.year': 1, 'paymentPeriod.month': 1 });
paymentTransactionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
```

---

## Step 5: Create Razorpay Service

Create `/var/www/opine/backend/services/razorpayService.js`:

```javascript
const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

/**
 * Create a payout to bank account
 * Note: Requires RazorpayX account or direct bank account setup
 */
async function createPayout(accountNumber, ifscCode, accountHolderName, amount, notes) {
  try {
    // Use RazorpayX account number if available, otherwise use direct bank account
    const sourceAccountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || 
                                 process.env.RAZORPAY_BANK_ACCOUNT_NUMBER;

    if (!sourceAccountNumber) {
      throw new Error('RazorpayX account number or bank account number not configured');
    }

    const payout = await razorpay.payouts.create({
      account_number: sourceAccountNumber, // Your RazorpayX account or company bank account
      fund_account: {
        account_type: 'bank_account',
        bank_account: {
          name: accountHolderName,
          ifsc: ifscCode,
          account_number: accountNumber
        }
      },
      amount: amount * 100, // Convert to paise (₹1 = 100 paise)
      currency: 'INR',
      mode: 'NEFT', // or 'IMPS' for instant transfers
      purpose: 'payout',
      queue_if_low_balance: true, // Queue if insufficient balance instead of failing
      reference_id: `PAYOUT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      notes: notes || {}
    });

    return payout;
  } catch (error) {
    console.error('Razorpay payout error:', error);
    throw error;
  }
}

/**
 * Create bulk payouts
 */
async function createBulkPayouts(payouts) {
  try {
    const bulkPayout = await razorpay.payouts.create({
      account_number: process.env.RAZORPAY_ACCOUNT_NUMBER, // Your RazorpayX account number
      fund_accounts: payouts.map(p => ({
        account_type: 'bank_account',
        bank_account: {
          name: p.accountHolderName,
          ifsc: p.ifscCode,
          account_number: p.accountNumber
        }
      })),
      payouts: payouts.map(p => ({
        fund_account_id: p.fundAccountId, // Need to create fund account first
        amount: p.amount * 100,
        currency: 'INR',
        mode: 'NEFT',
        purpose: 'payout',
        reference_id: p.referenceId,
        notes: p.notes || {}
      }))
    });

    return bulkPayout;
  } catch (error) {
    console.error('Razorpay bulk payout error:', error);
    throw error;
  }
}

/**
 * Get payout status
 */
async function getPayoutStatus(payoutId) {
  try {
    const payout = await razorpay.payouts.fetch(payoutId);
    return payout;
  } catch (error) {
    console.error('Razorpay fetch payout error:', error);
    throw error;
  }
}

/**
 * Verify webhook signature
 */
function verifyWebhookSignature(body, signature) {
  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(body));
  const generatedSignature = hmac.digest('hex');
  return generatedSignature === signature;
}

module.exports = {
  createPayout,
  createBulkPayouts,
  getPayoutStatus,
  verifyWebhookSignature
};
```

---

## Step 6: Create Payment Calculation Service

Create `/var/www/opine/backend/services/paymentCalculationService.js`:

```javascript
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

/**
 * Calculate payment for a user for a given period
 */
async function calculatePaymentForUser(userId, startDate, endDate) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Get all approved responses in the period
  const responses = await SurveyResponse.find({
    interviewer: userId,
    status: 'Approved',
    createdAt: {
      $gte: startDate,
      $lte: endDate
    }
  }).lean();

  // Calculate base amount (example: ₹10 per approved response)
  const baseRate = 10; // TODO: Get from user's payment settings or company config
  const completedInterviews = responses.length;
  const approvedResponses = responses.filter(r => r.status === 'Approved').length;

  // Base amount
  const baseAmount = approvedResponses * baseRate;

  // Quality bonus (example: 5% if quality score > 90)
  const qualityBonus = 0; // TODO: Calculate based on quality scores

  // Incentives
  const incentives = 0; // TODO: Calculate based on performance metrics

  // Deductions
  const deductions = 0;

  // TDS (10% if PAN not verified)
  const tdsRate = user.paymentSettings?.tdsExempt ? 0 : 0.10;
  const grossAmount = baseAmount + qualityBonus + incentives - deductions;
  const tds = grossAmount * tdsRate;
  const netAmount = grossAmount - tds;

  return {
    baseAmount,
    completedInterviews,
    approvedResponses,
    qualityBonus,
    incentives,
    deductions,
    tds,
    netAmount,
    grossAmount
  };
}

/**
 * Calculate payments for all eligible users
 */
async function calculatePaymentsForPeriod(companyId, startDate, endDate) {
  // Get all active interviewers and quality agents
  const users = await User.find({
    company: companyId,
    userType: { $in: ['interviewer', 'quality_agent'] },
    status: 'active',
    'bankDetails.isVerified': true
  }).lean();

  const calculations = [];

  for (const user of users) {
    try {
      const calculation = await calculatePaymentForUser(user._id, startDate, endDate);
      
      if (calculation.netAmount > 0) {
        calculations.push({
          user: user._id,
          memberId: user.memberId,
          calculation,
          bankDetails: user.bankDetails
        });
      }
    } catch (error) {
      console.error(`Error calculating payment for user ${user.memberId}:`, error);
    }
  }

  return calculations;
}

module.exports = {
  calculatePaymentForUser,
  calculatePaymentsForPeriod
};
```

---

## Step 7: Create Payment Scheduler

Create `/var/www/opine/backend/jobs/paymentScheduler.js`:

```javascript
const cron = require('node-cron');
const PaymentTransaction = require('../models/PaymentTransaction');
const { calculatePaymentsForPeriod } = require('../services/paymentCalculationService');
const { createPayout } = require('../services/razorpayService');
const Company = require('../models/Company');

/**
 * Check if today is payout day and execute payments
 */
async function executeMonthlyPayments() {
  console.log('🔄 Running monthly payment scheduler...');
  
  const today = new Date();
  const dayOfMonth = today.getDate();
  const currentHour = today.getHours();
  const currentMinute = today.getMinutes();

  // Get all companies with payment schedules
  const companies = await Company.find({
    'paymentConfig.payoutSchedule': 'monthly',
    'paymentConfig.payoutDay': dayOfMonth
  });

  for (const company of companies) {
    try {
      // Calculate previous month's period
      const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const endDate = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);

      console.log(`📊 Calculating payments for company ${company.name}...`);
      
      // Calculate payments
      const calculations = await calculatePaymentsForPeriod(
        company._id,
        startDate,
        endDate
      );

      console.log(`✅ Found ${calculations.length} eligible users`);

      // Create payment transactions
      for (const calc of calculations) {
        const transactionId = `TXN_${Date.now()}_${calc.memberId}`;
        
        const transaction = new PaymentTransaction({
          transactionId,
          user: calc.user,
          memberId: calc.memberId,
          amount: calc.calculation.netAmount,
          paymentPeriod: {
            startDate,
            endDate,
            month: startDate.getMonth() + 1,
            year: startDate.getFullYear()
          },
          calculationBreakdown: calc.calculation,
          bankDetails: calc.bankDetails,
          status: company.paymentConfig.autoApprove ? 'pending' : 'pending',
          requiresApproval: !company.paymentConfig.autoApprove
        });

        await transaction.save();

        // If auto-approve, initiate payment immediately
        if (company.paymentConfig.autoApprove) {
          await initiatePayment(transaction._id);
        }
      }

      console.log(`✅ Payments processed for company ${company.name}`);
    } catch (error) {
      console.error(`❌ Error processing payments for company ${company._id}:`, error);
    }
  }
}

/**
 * Initiate payment via Razorpay
 */
async function initiatePayment(transactionId) {
  const transaction = await PaymentTransaction.findById(transactionId)
    .populate('user');

  if (!transaction) {
    throw new Error('Transaction not found');
  }

  if (transaction.status !== 'pending') {
    throw new Error('Transaction already processed');
  }

  try {
    transaction.status = 'initiated';
    transaction.initiatedAt = new Date();
    await transaction.save();

    // Create payout via Razorpay
    const payout = await createPayout(
      transaction.bankDetails.accountNumber,
      transaction.bankDetails.ifscCode,
      transaction.bankDetails.accountHolderName,
      transaction.amount,
      {
        transactionId: transaction.transactionId,
        memberId: transaction.memberId,
        period: `${transaction.paymentPeriod.month}/${transaction.paymentPeriod.year}`
      }
    );

    // Update transaction with payout details
    transaction.payoutId = payout.id;
    transaction.gatewayResponse = {
      payoutId: payout.id,
      status: payout.status,
      rawResponse: payout
    };
    transaction.status = 'processing';
    await transaction.save();

    console.log(`✅ Payment initiated: ${transaction.transactionId} - Payout ID: ${payout.id}`);
    
    return transaction;
  } catch (error) {
    console.error(`❌ Payment initiation failed: ${transaction.transactionId}`, error);
    
    transaction.status = 'failed';
    transaction.gatewayResponse = {
      failureReason: error.message,
      rawResponse: error
    };
    await transaction.save();

    // Retry logic
    if (transaction.retryCount < transaction.maxRetries) {
      transaction.retryCount += 1;
      transaction.nextRetryAt = new Date(Date.now() + (transaction.retryCount * 60 * 60 * 1000)); // 1 hour, 2 hours, 3 hours
      transaction.status = 'pending';
      await transaction.save();
    }

    throw error;
  }
}

// Schedule: Run daily at 9:00 AM IST to check if it's payout day
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Payment scheduler triggered');
  await executeMonthlyPayments();
});

// Also run retry logic for failed payments
cron.schedule('0 */6 * * *', async () => {
  console.log('🔄 Checking for failed payments to retry...');
  
  const failedTransactions = await PaymentTransaction.find({
    status: 'pending',
    retryCount: { $lt: 3 },
    nextRetryAt: { $lte: new Date() }
  });

  for (const transaction of failedTransactions) {
    try {
      await initiatePayment(transaction._id);
    } catch (error) {
      console.error(`❌ Retry failed for ${transaction.transactionId}:`, error);
    }
  }
});

module.exports = {
  executeMonthlyPayments,
  initiatePayment
};
```

---

## Step 8: Create Webhook Handler

Create `/var/www/opine/backend/controllers/paymentWebhookController.js`:

```javascript
const { verifyWebhookSignature } = require('../services/razorpayService');
const PaymentTransaction = require('../models/PaymentTransaction');

/**
 * Handle Razorpay payout webhook
 */
const handlePayoutWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body;

    // Verify webhook signature
    if (!verifyWebhookSignature(body, signature)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = body.event;
    const payoutData = body.payload.payout.entity;

    // Find transaction by payout ID
    const transaction = await PaymentTransaction.findOne({
      payoutId: payoutData.id
    });

    if (!transaction) {
      console.warn(`Transaction not found for payout: ${payoutData.id}`);
      return res.status(200).json({ received: true });
    }

    // Update transaction status based on webhook event
    switch (event) {
      case 'payout.processed':
        transaction.status = 'success';
        transaction.gatewayResponse.status = payoutData.status;
        transaction.gatewayResponse.utr = payoutData.utr;
        transaction.gatewayResponse.processedAt = new Date(payoutData.processed_at * 1000);
        transaction.completedAt = new Date();
        break;

      case 'payout.failed':
        transaction.status = 'failed';
        transaction.gatewayResponse.status = payoutData.status;
        transaction.gatewayResponse.failureReason = payoutData.failure_reason;
        break;

      case 'payout.reversed':
        transaction.status = 'reversed';
        transaction.gatewayResponse.status = payoutData.status;
        break;

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    transaction.gatewayResponse.rawResponse = payoutData;
    await transaction.save();

    // Send notification to user (TODO: Implement notification service)
    if (transaction.status === 'success') {
      // Send success SMS/Email
    } else if (transaction.status === 'failed') {
      // Send failure notification
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = {
  handlePayoutWebhook
};
```

---

## Step 9: Add Routes

Add to `/var/www/opine/backend/routes/paymentRoutes.js`:

```javascript
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { handlePayoutWebhook } = require('../controllers/paymentWebhookController');
const PaymentTransaction = require('../models/PaymentTransaction');

// Webhook (no auth required - signature verification instead)
router.post('/webhook/razorpay', handlePayoutWebhook);

// Get pending payments (Admin only)
router.get('/pending', protect, authorize('super_admin', 'company_admin'), async (req, res) => {
  const transactions = await PaymentTransaction.find({
    status: 'pending',
    requiresApproval: true
  }).populate('user', 'firstName lastName memberId');

  res.json({ transactions });
});

// Approve payment
router.post('/:transactionId/approve', protect, authorize('super_admin', 'company_admin'), async (req, res) => {
  const { initiatePayment } = require('../jobs/paymentScheduler');
  
  const transaction = await PaymentTransaction.findById(req.params.transactionId);
  if (!transaction) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  transaction.approvedBy = req.user._id;
  transaction.approvedAt = new Date();
  await transaction.save();

  // Initiate payment
  await initiatePayment(transaction._id);

  res.json({ message: 'Payment approved and initiated', transaction });
});

module.exports = router;
```

---

## Step 10: Register Routes

Add to `/var/www/opine/backend/server.js`:

```javascript
const paymentRoutes = require('./routes/paymentRoutes');
app.use('/api/payments', paymentRoutes);
```

---

## Step 11: Start Scheduler

Add to `/var/www/opine/backend/server.js`:

```javascript
// Start payment scheduler
if (process.env.NODE_ENV !== 'test') {
  require('./jobs/paymentScheduler');
}
```

---

## Testing

### Test Payment Calculation
```javascript
const { calculatePaymentForUser } = require('./services/paymentCalculationService');

const startDate = new Date('2024-01-01');
const endDate = new Date('2024-01-31');
const userId = 'USER_ID_HERE';

const calculation = await calculatePaymentForUser(userId, startDate, endDate);
console.log(calculation);
```

### Test Manual Payment Initiation
```javascript
const { executeMonthlyPayments } = require('./jobs/paymentScheduler');
await executeMonthlyPayments();
```

---

## Next Steps

1. **Complete Payment Rate Configuration**: Define how much to pay per response
2. **Implement Bank Account Verification**: Use Razorpay's account verification API
3. **Build Admin Dashboard**: UI for approving payments
4. **Add Notifications**: SMS/Email notifications
5. **Test Thoroughly**: Test with small amounts first
6. **Deploy**: Start with manual trigger, then enable automation

---

**This guide provides a working foundation. Customize payment rates, add quality bonuses, and enhance based on your specific requirements.**

