# Enterprise Payment System Design - Opine Platform

## Executive Summary

This document outlines a production-grade payment system for monthly bulk payments to interviewers based on approved survey responses. The system is designed with enterprise-level reliability, security, and scalability similar to AWS/Google payment systems.

---

## 1. Payment Gateway Selection (India)

### Recommended: Razorpay X (Business Banking + Payouts)

**Why Razorpay X:**
- ✅ **UPI Instant Payouts**: Real-time payments to bank accounts
- ✅ **Bulk Payouts API**: Process thousands of payments in one API call
- ✅ **NEFT/IMPS Support**: Traditional bank transfers
- ✅ **Webhook Support**: Real-time payment status updates
- ✅ **Compliance**: PCI-DSS Level 1, RBI licensed
- ✅ **Cost-Effective**: ₹2 per UPI payout, ₹5 per NEFT
- ✅ **Dashboard**: Built-in reconciliation and reporting

**Alternative Options:**
1. **Cashfree Payouts**: Similar features, good for high volume
2. **Paytm Business**: Good UPI integration
3. **Stripe Connect**: International option (higher fees)

### Required Accounts Setup:

1. **Razorpay Business Account**
   - Register at: https://razorpay.com
   - Complete KYC (GST, PAN, Bank details)
   - Enable "RazorpayX" (Business Banking)
   - Get API Keys:
     - `RAZORPAY_KEY_ID` (public key)
     - `RAZORPAY_KEY_SECRET` (private key - keep secure!)

2. **Business Bank Account**
   - Link company bank account to RazorpayX
   - Maintain minimum balance for payouts
   - Enable auto-reconciliation

3. **Webhook Configuration**
   - Set webhook URL: `https://convo.convergentview.com/api/payments/webhook/razorpay`
   - Events to subscribe:
     - `payout.processed`
     - `payout.failed`
     - `payout.reversed`

---

## 2. System Architecture

### 2.1 High-Level Flow

```
┌─────────────────┐
│ Accounts Admin  │
│   Approves      │
│   Payment Batch │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Payment Batch   │
│   Created       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌──────────────┐
│ Queue: Payment  │─────▶│  Worker      │
│   Processing    │      │  Processes   │
└─────────────────┘      │  in Batches  │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Razorpay API │
                         │   Bulk API   │
                         └──────┬───────┘
                                │
                                ▼
                         ┌──────────────┐
                         │ Webhook      │
                         │  Updates     │
                         └──────────────┘
```

### 2.2 Core Components

1. **Payment Models** (MongoDB)
   - `PaymentBatch`: Monthly payment batches
   - `PaymentTransaction`: Individual payment records
   - `PaymentConfig`: Company payment settings

2. **Queue System** (BullMQ + Redis)
   - `payment-processing`: Bulk payment processing queue
   - `payment-webhook`: Webhook processing queue

3. **Workers** (PM2)
   - `payment-worker`: Processes payment batches
   - `payment-webhook-worker`: Handles webhook callbacks

4. **Controllers**
   - `paymentController.js`: Payment batch management
   - `paymentWebhookController.js`: Webhook handling

5. **Services**
   - `razorpayService.js`: Razorpay API integration
   - `paymentCalculationService.js`: Calculate payments per interviewer

---

## 3. Database Schema Design

### 3.1 PaymentBatch Model

```javascript
{
  batchId: String,              // Unique: PAY-YYYY-MM-001
  company: ObjectId,            // Company reference
  period: {
    month: Number,               // 1-12
    year: Number                 // 2026
  },
  status: {
    type: String,
    enum: ['draft', 'pending_approval', 'approved', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'draft'
  },
  approvedBy: ObjectId,          // Accounts Admin who approved
  approvedAt: Date,
  totalAmount: Number,           // Total payout amount (in paise)
  totalTransactions: Number,     // Number of payments
  processedTransactions: Number,  // Successfully processed
  failedTransactions: Number,    // Failed payments
  razorpayPayoutId: String,     // Razorpay batch ID
  metadata: {
    calculationDate: Date,
    approvedResponses: Number,
    paymentRate: Number          // Amount per approved interview
  },
  createdAt: Date,
  updatedAt: Date
}
```

### 3.2 PaymentTransaction Model

```javascript
{
  transactionId: String,         // Unique: TXN-YYYYMMDD-XXXXX
  batch: ObjectId,               // PaymentBatch reference
  interviewer: ObjectId,          // User reference
  company: ObjectId,
  amount: Number,                // Amount in paise
  currency: String,              // 'INR'
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'reversed', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'neft', 'imps'],
    default: 'upi'
  },
  recipientDetails: {
    accountNumber: String,       // Masked: XXXX1234
    ifsc: String,
    name: String,
    upiId: String               // Optional for UPI
  },
  razorpayPayoutId: String,      // Razorpay transaction ID
  razorpayStatus: String,        // From webhook
  approvedResponses: [{
    responseId: ObjectId,        // SurveyResponse reference
    amount: Number               // Amount for this response
  }],
  failureReason: String,          // If failed
  processedAt: Date,
  completedAt: Date,
  webhookData: Object,           // Raw webhook payload
  auditLog: [{
    action: String,
    performedBy: ObjectId,
    timestamp: Date,
    notes: String
  }],
  createdAt: Date,
  updatedAt: Date
}
```

### 3.3 PaymentConfig Model

```javascript
{
  company: ObjectId,             // One config per company
  paymentRate: {
    capi: Number,                // Amount per approved CAPI interview (in paise)
    cati: Number                 // Amount per approved CATI interview (in paise)
  },
  paymentSchedule: {
    dayOfMonth: Number,          // Day of month to process (1-28)
    time: String                 // '09:00' (IST)
  },
  razorpayConfig: {
    keyId: String,               // Encrypted
    keySecret: String,           // Encrypted
    accountId: String            // RazorpayX account ID
  },
  autoApprove: Boolean,          // Auto-approve if under threshold
  approvalThreshold: Number,     // Amount threshold for auto-approval
  notificationSettings: {
    emailOnCompletion: Boolean,
    emailRecipients: [String]
  },
  createdAt: Date,
  updatedAt: Date
}
```

---

## 4. User Role: Accounts Admin

### 4.1 Add to User Model

```javascript
// In User.js enum
userType: {
  type: String,
  enum: [
    'super_admin', 
    'company_admin', 
    'project_manager', 
    'state_manager', 
    'interviewer', 
    'quality_agent', 
    'Data_Analyst',
    'accounts_admin'  // NEW
  ],
  default: 'interviewer'
}
```

### 4.2 Permissions

**Accounts Admin can:**
- ✅ View all payment batches
- ✅ Approve/reject payment batches
- ✅ View payment transactions
- ✅ View payment reports
- ✅ Configure payment settings
- ✅ Reconcile payments
- ❌ Cannot approve their own payments
- ❌ Cannot modify approved batches

---

## 5. Payment Calculation Logic

### 5.1 Monthly Payment Calculation Flow

```javascript
// Pseudo-code
1. Get all approved SurveyResponses for the month
   WHERE status = 'Approved'
   AND approvedAt BETWEEN startOfMonth AND endOfMonth
   AND NOT paymentProcessed = true

2. Group by interviewer
   GROUP BY interviewer

3. Calculate amount per interviewer
   FOR EACH interviewer:
     capiCount = COUNT(CAPI responses)
     catiCount = COUNT(CATI responses)
     amount = (capiCount * capiRate) + (catiCount * catiRate)

4. Create PaymentBatch (status: 'draft')

5. Create PaymentTransaction for each interviewer

6. Wait for Accounts Admin approval

7. Process payments via Razorpay Bulk API
```

### 5.2 Payment Rate Configuration

- **CAPI Rate**: Configurable per company (e.g., ₹50 per approved interview)
- **CATI Rate**: Configurable per company (e.g., ₹30 per approved interview)
- **Minimum Payout**: ₹100 (configurable)
- **Maximum Payout**: No limit (configurable)

---

## 6. Implementation Details

### 6.1 Queue-Based Processing (BullMQ)

**Why Queue-Based:**
- ✅ Non-blocking: API responds immediately
- ✅ Retry logic: Automatic retry on failures
- ✅ Rate limiting: Respect Razorpay API limits
- ✅ Scalable: Multiple workers can process
- ✅ Memory efficient: Processes in batches

**Queue Configuration:**
```javascript
// paymentQueue.js
const paymentQueue = new Queue('payment-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: {
      age: 86400 * 30,  // Keep 30 days
      count: 1000
    },
    removeOnFail: {
      age: 86400 * 90   // Keep failed jobs 90 days
    }
  }
});
```

### 6.2 Batch Processing Strategy

**Razorpay Bulk Payout API:**
- Max 1000 transactions per batch
- Process in chunks of 1000
- Use `Promise.allSettled()` for parallel processing
- Implement circuit breaker pattern

**Memory Optimization:**
- Use MongoDB cursors (streaming) instead of loading all data
- Process in batches of 100 transactions
- Clear processed data from memory immediately
- Use Redis for temporary data storage

### 6.3 Security Measures

1. **API Key Encryption**
   ```javascript
   // Use crypto for encryption
   const encrypted = crypto.createCipher('aes-256-gcm', masterKey);
   // Store encrypted in database
   ```

2. **Webhook Signature Verification**
   ```javascript
   // Always verify Razorpay webhook signatures
   const crypto = require('crypto');
   const signature = crypto
     .createHmac('sha256', RAZORPAY_SECRET)
     .update(JSON.stringify(req.body))
     .digest('hex');
   ```

3. **Audit Trail**
   - Log all payment actions
   - Store who approved what
   - Track all status changes
   - Maintain immutable audit logs

4. **Rate Limiting**
   - Max 100 API calls per minute (Razorpay limit)
   - Implement token bucket algorithm
   - Queue requests if limit exceeded

---

## 7. Error Handling & Retry Logic

### 7.1 Failure Scenarios

1. **API Failures**
   - Network errors → Retry with exponential backoff
   - Rate limit → Queue and retry later
   - Invalid data → Log and skip, notify admin

2. **Payment Failures**
   - Insufficient balance → Notify admin, pause processing
   - Invalid bank details → Mark transaction failed, notify interviewer
   - Bank rejection → Retry once, then mark failed

3. **System Failures**
   - Database errors → Retry with backoff
   - Worker crash → PM2 auto-restart, resume from last checkpoint

### 7.2 Retry Strategy

```javascript
// Exponential backoff with jitter
const retryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,      // 1 second
  maxDelay: 30000,         // 30 seconds
  multiplier: 2,
  jitter: true             // Add randomness
};
```

---

## 8. Monitoring & Observability

### 8.1 Metrics to Track

- Payment batch processing time
- Success/failure rates
- API response times
- Queue depth
- Memory usage
- Error rates by type

### 8.2 Logging

```javascript
// Structured logging
logger.info('Payment batch processing started', {
  batchId: 'PAY-2026-02-001',
  transactionCount: 150,
  totalAmount: 7500000,
  timestamp: new Date().toISOString()
});
```

### 8.3 Alerts

- Payment batch stuck > 1 hour
- Failure rate > 5%
- API errors > 10 in 5 minutes
- Insufficient balance
- Webhook failures

---

## 9. API Endpoints

### 9.1 Payment Batch Management

```
POST   /api/payments/batches/create          - Create payment batch
GET    /api/payments/batches                 - List all batches
GET    /api/payments/batches/:batchId        - Get batch details
POST   /api/payments/batches/:batchId/approve - Approve batch (Accounts Admin)
POST   /api/payments/batches/:batchId/reject  - Reject batch
POST   /api/payments/batches/:batchId/process - Process batch
GET    /api/payments/batches/:batchId/transactions - Get transactions
```

### 9.2 Payment Transactions

```
GET    /api/payments/transactions            - List transactions
GET    /api/payments/transactions/:txnId     - Get transaction details
GET    /api/payments/interviewer/:userId    - Get interviewer payment history
```

### 9.3 Configuration

```
GET    /api/payments/config                  - Get payment config
PUT    /api/payments/config                  - Update config (Accounts Admin)
```

### 9.4 Webhooks

```
POST   /api/payments/webhook/razorpay        - Razorpay webhook endpoint
```

---

## 10. Frontend Components

### 10.1 Payment Dashboard (Accounts Admin)

- **Payment Batches List**
  - Filter by month, status
  - View total amount, transaction count
  - Approve/Reject buttons

- **Batch Details**
  - List of all transactions
  - Interviewer details
  - Approved responses breakdown
  - Payment status

- **Payment Reports**
  - Monthly payment summary
  - Top interviewers by earnings
  - Payment trends

### 10.2 Interviewer Payment View

- **Payment History**
  - Monthly earnings
  - Payment status
  - Download receipts

---

## 11. Implementation Checklist

### Phase 1: Foundation (Week 1)
- [ ] Add `accounts_admin` user type to User model
- [ ] Create PaymentBatch, PaymentTransaction, PaymentConfig models
- [ ] Set up Razorpay account and get API keys
- [ ] Create Razorpay service wrapper
- [ ] Implement payment calculation service

### Phase 2: Core Features (Week 2)
- [ ] Create payment batch creation endpoint
- [ ] Implement approval workflow
- [ ] Set up payment processing queue
- [ ] Create payment worker
- [ ] Implement bulk payout API integration

### Phase 3: Webhooks & Error Handling (Week 3)
- [ ] Implement webhook endpoint
- [ ] Create webhook worker
- [ ] Add retry logic
- [ ] Implement error handling
- [ ] Add audit logging

### Phase 4: Frontend & Testing (Week 4)
- [ ] Create payment dashboard UI
- [ ] Add payment history view
- [ ] Implement approval UI
- [ ] End-to-end testing
- [ ] Load testing

### Phase 5: Production Deployment
- [ ] Security audit
- [ ] Performance optimization
- [ ] Documentation
- [ ] Monitoring setup
- [ ] Gradual rollout

---

## 12. Cost Estimation

### Razorpay Fees (Example: 1000 payments/month)
- **UPI Payouts**: ₹2 × 1000 = ₹2,000/month
- **NEFT Payouts**: ₹5 × 1000 = ₹5,000/month (if UPI fails)
- **API Calls**: Free (unlimited)
- **Webhooks**: Free

### Infrastructure Costs
- **Redis**: Already in use (no additional cost)
- **MongoDB Storage**: ~100MB/month for payment data
- **Worker Processes**: Minimal CPU/memory overhead

**Total Estimated Cost**: ₹2,000 - ₹5,000/month

---

## 13. Security Best Practices

1. **Encrypt sensitive data** (API keys, bank details)
2. **Use HTTPS** for all API calls
3. **Verify webhook signatures** always
4. **Implement rate limiting** on APIs
5. **Audit all payment actions**
6. **Two-factor approval** for large amounts
7. **Regular security audits**
8. **Compliance with RBI regulations**

---

## 14. Scalability Considerations

- **Horizontal Scaling**: Multiple payment workers
- **Database Indexing**: Optimize queries for large datasets
- **Caching**: Redis cache for frequently accessed data
- **Batch Processing**: Process in chunks to avoid memory issues
- **Streaming**: Use MongoDB cursors for large datasets

---

## 15. Compliance & Legal

- **GST Compliance**: Issue payment receipts
- **TDS Deduction**: If applicable (configurable)
- **Audit Trail**: Maintain records for 7 years
- **Data Privacy**: Encrypt PII (bank details)
- **RBI Compliance**: Follow payment regulations

---

## Next Steps

1. **Review this design** with stakeholders
2. **Set up Razorpay account** and get API keys
3. **Create Accounts Admin user** for testing
4. **Start Phase 1 implementation**
5. **Test with small batch** before full rollout

---

**Document Version**: 1.0  
**Last Updated**: February 18, 2026  
**Author**: AI Assistant  
**Status**: Draft - Pending Review














