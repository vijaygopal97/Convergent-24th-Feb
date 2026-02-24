# CATI Interview API Test Endpoints

## Base URL
**Production:** `https://convo.convergentview.com`

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## 1. Start CATI Interview
**Endpoint:** `POST /api/cati-interview/start/:surveyId`

**Description:** Starts a CATI interview session and assigns the next available respondent from the queue.

**URL Parameters:**
- `surveyId` (required) - The survey ID (e.g., `68fd1915d41841da463f0d46`)

**Request Body:** Empty `{}`

**Example Request:**
```bash
curl -X POST \
  'https://convo.convergentview.com/api/cati-interview/start/68fd1915d41841da463f0d46' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "sessionId": "session_123456",
    "respondent": {
      "id": "69817265ccfa473fd293bb3c",
      "phone": "9876543210",
      "name": "John Doe",
      "ac": "Kharagpur Sadar",
      "pc": "PC123"
    },
    "survey": {
      "surveyName": "Survey Name",
      "surveyId": "68fd1915d41841da463f0d46"
    }
  }
}
```

**Error Responses:**
- `400` - Survey ID is required / Survey is not active
- `401` - User not authenticated
- `403` - You are not assigned to this survey for CATI interviews
- `404` - Survey not found / No respondents available in queue
- `500` - Server error

---

## 2. Make Call to Respondent
**Endpoint:** `POST /api/cati-interview/make-call/:queueId`

**Description:** Initiates a call to the assigned respondent. This is a non-blocking operation that queues the call job.

**URL Parameters:**
- `queueId` (required) - The queue entry ID from the start interview response (e.g., `69817265ccfa473fd293bb3c`)

**Request Body:** Empty `{}`

**Example Request:**
```bash
curl -X POST \
  'https://convo.convergentview.com/api/cati-interview/make-call/69817265ccfa473fd293bb3c' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Call initiation queued. Please check status using the call-status endpoint.",
  "data": {
    "jobId": "cati-call-69817265ccfa473fd293bb3c",
    "queueId": "69817265ccfa473fd293bb3c",
    "status": "queued",
    "statusEndpoint": "/api/cati-interview/call-status/69817265ccfa473fd293bb3c"
  }
}
```

**Error Responses:**
- `400` - Interviewer phone number not found
- `403` - You are not assigned to this respondent
- `404` - Respondent queue entry not found
- `500` - Server error

---

## 3. Check Call Status
**Endpoint:** `GET /api/cati-interview/call-status/:queueId`

**Description:** Checks the status of a queued call.

**URL Parameters:**
- `queueId` (required) - The queue entry ID

**Example Request:**
```bash
curl -X GET \
  'https://convo.convergentview.com/api/cati-interview/call-status/69817265ccfa473fd293bb3c' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN'
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "queueId": "69817265ccfa473fd293bb3c",
    "status": "ringing",
    "callId": "call_123456",
    "callRecord": {
      "callStatus": "ringing",
      "webhookReceived": false
    }
  }
}
```

---

## Complete Test Flow

### Step 1: Get JWT Token
First, authenticate and get your JWT token:
```bash
curl -X POST \
  'https://convo.convergentview.com/api/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "your_email@example.com",
    "password": "your_password"
  }'
```

### Step 2: Start Interview
```bash
SURVEY_ID="68fd1915d41841da463f0d46"
TOKEN="YOUR_JWT_TOKEN"

RESPONSE=$(curl -X POST \
  "https://convo.convergentview.com/api/cati-interview/start/${SURVEY_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}')

echo $RESPONSE
```

### Step 3: Extract Queue ID and Make Call
```bash
QUEUE_ID=$(echo $RESPONSE | jq -r '.data.respondent.id')

curl -X POST \
  "https://convo.convergentview.com/api/cati-interview/make-call/${QUEUE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 4: Check Call Status
```bash
curl -X GET \
  "https://convo.convergentview.com/api/cati-interview/call-status/${QUEUE_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

---

## Troubleshooting

### If calls are not coming through:

1. **Check Worker Status:**
   ```bash
   # On server
   pm2 logs opine-cati-call-worker --lines 50
   ```

2. **Check for Errors:**
   - Look for "No Callgroup" errors (CloudTelephony account issue)
   - Look for "Call initiation failed" errors
   - Check if jobs are being queued: `pm2 logs opine-backend | grep "CATI call job"`

3. **Verify Webhook URL:**
   - DeepCall dashboard should have: `https://convo.convergentview.com/api/cati/webhook`
   - CloudTelephony should have: `https://convo.convergentview.com/api/cati/webhook/cloudtelephony`

4. **Check Provider Configuration:**
   - Verify company has CATI provider configured
   - Check if provider is enabled in company settings

---

## Notes

- The `make-call` endpoint is **non-blocking** - it queues the call and returns immediately
- Use the `call-status` endpoint to poll for call status
- Calls are processed by the `opine-cati-call-worker` PM2 process
- Webhook URLs have been updated to use `https://convo.convergentview.com`



