# Opine Platform - Complete Architecture Understanding

## Overview

The Opine platform is a comprehensive market research platform connecting research companies with field interviewers across India. It consists of:

1. **MERN Stack Web Application** (`/var/www/opine`)
   - Backend: Node.js + Express + MongoDB
   - Frontend: React 19 + Vite + Tailwind CSS
   - Production URL: `https://opine.exypnossolutions.com` / `https://convo.convergentview.com`

2. **React Native Mobile Application** (`/var/www/Opine-Android`)
   - React Native 0.81.5 + Expo SDK 54
   - TypeScript
   - For field interviewers to conduct CAPI/CATI interviews

---

## 1. MERN Stack Backend (`/var/www/opine/backend`)

### Technology Stack
- **Runtime**: Node.js
- **Framework**: Express.js 4.21.2
- **Database**: MongoDB with Mongoose 8.9.2
- **Authentication**: JWT (jsonwebtoken 9.0.2)
- **File Upload**: Multer 2.0.2
- **Queue System**: Bull 4.16.5 + Redis (ioredis 5.9.0)
- **Cloud Storage**: AWS S3 (aws-sdk 2.1692.0)
- **Background Jobs**: node-cron 4.2.1
- **Email**: nodemailer 7.0.6

### Key Features
- Multi-tenant platform (companies, project managers, interviewers, quality agents)
- Survey management (CAPI, CATI, Online, Multi-mode)
- Response collection and quality control
- Audio recording storage (S3)
- CSV report generation
- Real-time analytics and dashboards
- CATI integration (CloudTelephony, DeepCall)
- QC batch processing system
- Performance tracking and metrics

### Project Structure
```
backend/
├── server.js                 # Main Express server
├── dbConnection.js            # MongoDB connection
├── models/                    # Mongoose models
│   ├── User.js
│   ├── Survey.js
│   ├── SurveyResponse.js
│   ├── Company.js
│   ├── QCBatch.js
│   ├── CatiCall.js
│   └── ...
├── controllers/               # Route handlers
│   ├── authController.js
│   ├── surveyController.js
│   ├── surveyResponseController.js
│   ├── catiController.js
│   └── ...
├── routes/                    # Express routes
│   ├── authRoutes.js
│   ├── surveyRoutes.js
│   ├── surveyResponseRoutes.js
│   └── ...
├── middleware/                # Custom middleware
│   ├── auth.js               # JWT authentication
│   ├── upload.js             # File upload handling
│   └── validation.js
├── services/                  # External service integrations
│   └── catiProviders/        # CATI provider integrations
├── jobs/                      # Background jobs
│   ├── startBackgroundJobs.js
│   ├── qcBatchProcessor.js
│   └── ...
├── queues/                    # Bull queue definitions
│   └── catiCallQueue.js
└── utils/                     # Utility functions
```

### Key Models

#### User Model
- **User Types**: `super_admin`, `company_admin`, `project_manager`, `interviewer`, `quality_agent`, `Data_Analyst`
- **Key Fields**:
  - Authentication: email, phone, password (bcrypt hashed)
  - Profile: firstName, lastName, memberId, interviewerProfile
  - Permissions: userType, company, status
  - Performance: trustScore, totalInterviews, approvedInterviews
  - Interview Modes: interviewModes (CAPI/CATI/Both), canSelectMode
  - Location Control: locationControlBooster (bypass geofencing)

#### Survey Model
- **Survey Modes**: `online`, `capi`, `cati`, `ai_telephonic`, `online_interview`, `multi_mode`
- **Key Fields**:
  - Basic: surveyName, description, category, purpose
  - Configuration: mode, modes[], modeAllocation, modeQuotas
  - Timeline: startDate, deadline, actualStartDate, actualEndDate
  - Sample: sampleSize, targetAudience
  - Assignment: assignedInterviewers[], capiInterviewers[], catiInterviewers[], assignedQualityAgents[]
  - Questions: sections[], questions[] (with conditional logic)
  - CATI: respondentContacts[] (phone numbers for CATI)
  - Analytics: responses[], analytics (completion rates, etc.)

#### SurveyResponse Model
- **Status Values**: `Pending_Approval`, `Approved`, `Rejected`, `completed`, `abandoned`, `Terminated`
- **Key Fields**:
  - Identity: responseId (UUID), sessionId (unique), survey, interviewer
  - Timing: startTime, endTime, totalTimeSpent (seconds)
  - Data: responses[] (complete question-answer pairs)
  - Context: interviewMode (capi/cati/online), setNumber (CATI sets)
  - Location: location (GPS coordinates, address)
  - Audio: audioRecording (S3 URL, duration, format)
  - Quality: qualityMetrics, verificationData
  - CATI: call_id (DeepCall), knownCallStatus
  - Abandonment: abandonedReason, lastSkippedAt
  - QC: qcBatch, isSampleResponse, autoApproved
  - Duplicate Detection: contentHash (SHA256)

### API Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login (returns JWT)
- `POST /api/auth/logout` - Logout (invalidate token)
- `GET /api/auth/verify` - Verify token
- `GET /api/auth/me` - Get current user

#### Surveys
- `GET /api/surveys` - List surveys (filtered by user role)
- `GET /api/surveys/:id` - Get survey details
- `GET /api/surveys/:id/full` - Get full survey with all data
- `POST /api/surveys` - Create survey (admin/project_manager)
- `PUT /api/surveys/:id` - Update survey
- `DELETE /api/surveys/:id` - Delete survey
- `POST /api/surveys/:id/publish` - Publish survey
- `POST /api/surveys/:id/assign-interviewers` - Assign interviewers
- `GET /api/surveys/available` - Get available surveys for interviewer
- `GET /api/surveys/:id/stats` - Get survey statistics
- `GET /api/surveys/:id/analytics` - Get survey analytics

#### Survey Responses
- `POST /api/responses/start` - Start interview session
- `GET /api/responses/session/:sessionId` - Get interview session
- `PUT /api/responses/session/:sessionId` - Update response
- `POST /api/responses/session/:sessionId/complete` - Complete interview
- `POST /api/responses/session/:sessionId/abandon` - Abandon interview
- `POST /api/responses/session/:sessionId/audio` - Upload audio file
- `GET /api/responses/my-interviews` - Get interviewer's interviews
- `GET /api/responses/survey/:surveyId/responses-v2` - Get all responses (paginated, filtered)
- `POST /api/responses/:id/approve` - Approve response (quality agent)
- `POST /api/responses/:id/reject` - Reject response
- `GET /api/responses/next-review` - Get next review assignment (QC queue)
- `POST /api/responses/:id/verify` - Submit verification (QC)

#### CATI
- `GET /api/cati/agents` - Get CATI agents
- `POST /api/cati/agents` - Create CATI agent
- `GET /api/cati/queue` - Get CATI priority queue
- `POST /api/cati/call` - Initiate CATI call
- `POST /api/cati/webhook` - CATI provider webhook
- `GET /api/cati/stats` - CATI statistics

#### Reports & Analytics
- `GET /api/reports/survey/:surveyId` - Generate survey report
- `GET /api/reports/csv/:surveyId` - Download CSV
- `POST /api/reports/csv/job` - Create CSV generation job
- `GET /api/reports/csv/job/:jobId` - Get CSV job progress
- `GET /api/performance/interviewer` - Interviewer performance stats
- `GET /api/performance/qc` - QC performance stats

### Authentication Flow
1. User logs in via `/api/auth/login` with email/phone + password
2. Backend validates credentials, generates JWT token
3. Token returned to client, stored in localStorage (web) or AsyncStorage (mobile)
4. All subsequent requests include `Authorization: Bearer <token>` header
5. `protect` middleware validates token on protected routes
6. `authorize` middleware checks user role permissions

### Background Jobs
- **QC Batch Processing**: Processes quality control batches
- **Available Assignments Update**: Updates available survey assignments
- **CATI Priority Queue Update**: Updates CATI call queue
- **CSV Generation**: Generates large CSV reports asynchronously

---

## 2. MERN Stack Frontend (`/var/www/opine/frontend`)

### Technology Stack
- **Framework**: React 19.1.1
- **Build Tool**: Vite 7.1.7
- **Routing**: React Router DOM 7.9.1
- **Styling**: Tailwind CSS 3.4.17
- **Icons**: Lucide React 0.544.0
- **Charts**: Chart.js 4.5.1 + React ChartJS 2
- **HTTP Client**: Axios 1.12.2
- **SEO**: React Helmet Async 2.0.5

### Project Structure
```
frontend/
├── src/
│   ├── App.jsx                 # Main app component
│   ├── main.jsx                 # Entry point
│   ├── components/              # React components
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   ├── Header.jsx
│   │   ├── Footer.jsx
│   │   ├── dashboard/           # Dashboard components
│   │   └── common/              # Common components
│   ├── pages/                   # Page components
│   │   ├── SurveyReportsPage.jsx
│   │   ├── ViewResponsesPage.jsx
│   │   ├── QCBatchesPage.jsx
│   │   └── ...
│   ├── contexts/                # React contexts
│   │   ├── AuthContext.jsx
│   │   └── ToastContext.jsx
│   ├── services/                # API services
│   │   └── api.js              # Axios instance
│   ├── hooks/                   # Custom hooks
│   ├── utils/                   # Utility functions
│   └── config/                  # Configuration
│       └── seo.js               # SEO management
├── public/                      # Static assets
└── dist/                        # Build output
```

### Key Features
- **Role-based Dashboards**: Different views for admin, project manager, interviewer, quality agent
- **Survey Management**: Create, edit, assign, publish surveys
- **Response Viewing**: View, filter, approve/reject responses
- **Analytics**: Charts and statistics for surveys and performance
- **QC Batch Management**: Quality control batch processing
- **CSV Export**: Download survey responses as CSV
- **SEO Management**: Environment-based SEO control

### API Integration
- Base URL: Environment-based (`VITE_API_BASE_URL`)
- HTTPS: Uses relative paths to avoid mixed content errors
- Authentication: JWT token in localStorage, sent via Authorization header
- Error Handling: Centralized error handling with toast notifications

---

## 3. React Native Mobile App (`/var/www/Opine-Android`)

### Technology Stack
- **Framework**: React Native 0.81.5
- **Platform**: Expo SDK ~54.0.30
- **Language**: TypeScript 5.9.2
- **Navigation**: React Navigation 7 (Stack + Bottom Tabs)
- **UI Components**: React Native Paper 5.14.5 (Material Design)
- **Storage**: AsyncStorage 2.2.0
- **Location**: Expo Location 19.0.8
- **Audio**: Expo AV 16.0.8
- **File System**: Expo File System 19.0.21
- **Network**: Axios 1.12.2 + NetInfo 11.4.1

### Project Structure
```
Opine-Android/
├── App.tsx                      # Main app component
├── src/
│   ├── screens/                 # Screen components
│   │   ├── SplashScreen.tsx
│   │   ├── LoginScreen.tsx
│   │   ├── InterviewerDashboard.tsx
│   │   ├── QualityAgentDashboard.tsx
│   │   ├── AvailableSurveys.tsx
│   │   ├── MyInterviews.tsx
│   │   ├── InterviewInterface.tsx
│   │   └── InterviewDetails.tsx
│   ├── services/                # Services
│   │   ├── api.ts              # API service (3287 lines!)
│   │   ├── offlineStorage.ts   # Local data persistence
│   │   ├── offlineDataCache.ts # Offline caching
│   │   ├── performanceCache.ts # Performance optimization
│   │   ├── syncService.ts      # Data synchronization
│   │   ├── analyticsService.ts # Analytics tracking
│   │   └── appUpdateService.ts # App update management
│   ├── components/              # Reusable components
│   │   ├── AppUpdateModal.tsx
│   │   ├── ResponseDetailsModal.tsx
│   │   └── SurveyDetailsModal.tsx
│   ├── types/                   # TypeScript types
│   │   └── index.ts
│   ├── utils/                   # Utility functions
│   │   ├── location.ts
│   │   ├── genderUtils.ts
│   │   └── translations.tsx
│   └── theme/                   # App theming
│       └── theme.ts
└── assets/                      # Static assets
```

### Key Features

#### Authentication
- Offline-first authentication (cached credentials)
- JWT token stored in AsyncStorage
- Background token verification (non-blocking)
- Automatic logout on token expiration

#### Interview Interface
- **CAPI (Face-to-Face)**:
  - Native GPS location capture (high accuracy)
  - Audio recording (Expo AV)
  - Multiple question types (text, multiple choice, rating, date, etc.)
  - Progress tracking
  - Auto-save functionality
  - Location verification required

- **CATI (Telephonic)**:
  - Phone call integration
  - Call status tracking
  - Set-based question routing
  - Consent form handling
  - Call outcome tracking

#### Offline Support
- **Offline Storage**: Local data persistence with AsyncStorage
- **Offline Cache**: Cached surveys, responses, dependent data
- **Sync Service**: Automatic synchronization when online
- **Conflict Resolution**: Handles data conflicts gracefully
- **Background Sync**: Syncs in background without blocking UI

#### Performance Optimizations
- **Request Deduplication**: Prevents duplicate concurrent requests
- **Response Caching**: 5-minute cache TTL for API responses
- **Performance Cache**: Pre-loaded performance data
- **Network Condition Emulation**: Testing for slow/unstable networks
- **Lazy Loading**: Dynamic imports for heavy modules

### API Connection
- **Base URL**: `https://convo.convergentview.com` (hardcoded in api.ts)
- **Alternative**: `https://opine.exypnossolutions.com`
- **Authentication**: JWT token in AsyncStorage, sent via Authorization header
- **Offline Mode**: Falls back to cached data when offline
- **Retry Logic**: Automatic retry for failed requests
- **Timeout**: 10-minute timeout for large uploads

### Data Flow

#### Interview Flow (CAPI)
1. User logs in → Token stored → Dashboard loads
2. User selects survey → Survey data downloaded (cached offline)
3. User starts interview → Session created → GPS location captured
4. User answers questions → Responses saved locally (auto-save)
5. Audio recording starts → Recorded during interview
6. User completes interview → All data synced to backend
7. Audio uploaded to S3 → Response marked as complete

#### Interview Flow (CATI)
1. User logs in → Token stored → Dashboard loads
2. User selects survey → Survey data downloaded
3. User selects set number → Questions filtered by set
4. User initiates call → Call ID generated
5. User conducts interview → Responses saved locally
6. User selects call status → Call outcome recorded
7. User completes interview → Data synced to backend

---

## 4. Data Models & Relationships

### User → Survey
- **Many-to-Many**: Users can be assigned to multiple surveys
- **Assignment Types**: 
  - `assignedInterviewers[]` (legacy, single mode)
  - `capiInterviewers[]` (CAPI mode)
  - `catiInterviewers[]` (CATI mode)
  - `assignedQualityAgents[]` (QC)

### Survey → SurveyResponse
- **One-to-Many**: Survey has many responses
- **Response Status**: Tracks approval workflow
- **QC Assignment**: Responses assigned to quality agents for review

### User → SurveyResponse
- **One-to-Many**: Interviewer creates many responses
- **Performance Tracking**: Responses affect interviewer trust score

### QCBatch → SurveyResponse
- **One-to-Many**: Batch contains many responses
- **Sample Selection**: 40% of responses in batch are sample
- **Batch Approval**: Auto-approval based on batch approval rate

---

## 5. Key Business Logic

### Survey Assignment
- **AC Assignment**: Surveys can be assigned by Assembly Constituency
- **Mode Allocation**: Multi-mode surveys split between CAPI/CATI
- **Gig Workers**: Can include/exclude gig workers per mode
- **Quotas**: Mode-specific quotas for multi-mode surveys

### Response Quality Control
- **QC Batch System**: Responses grouped into batches
- **Sample Selection**: 40% of responses reviewed (sample)
- **Batch Approval**: If sample approval rate > threshold, auto-approve rest
- **Queue System**: Quality agents get next assignment from queue
- **Skipped Responses**: Pushed to end of queue

### Duplicate Detection
- **Content Hash**: SHA256 hash of response content
- **CAPI**: Hash based on survey + startTime + endTime + duration + responses
- **CATI**: Hash based on survey + call_id (call_id is unique identifier)
- **Database Index**: Unique index on contentHash (prevents duplicates)
- **Race Condition Handling**: Handles simultaneous duplicate submissions

### Abandoned Responses
- **Status Protection**: Once status is "abandoned", cannot be changed
- **Abandoned Reason**: Required when abandoning interview
- **Database Constraints**: Schema-level protection against status changes
- **Offline Detection**: Detects abandoned interviews from offline sync

### Audio Recording
- **Storage**: Uploaded to AWS S3
- **Format**: WebM (default), Opus codec, 32kbps bitrate
- **Upload**: Separate endpoint for audio file upload
- **Proxy**: Audio served via proxy endpoint (S3 signed URLs)
- **Validation**: Only creates audioRecording object if audio exists

### CATI Integration
- **Providers**: CloudTelephony, DeepCall
- **Webhook**: Receives call events from provider
- **Call Queue**: Priority-based queue for CATI calls
- **Call Status**: Tracks call outcomes (connected, busy, not reachable, etc.)
- **Set System**: Questions organized into sets for CATI

---

## 6. Security & Performance

### Security
- **JWT Authentication**: Token-based authentication
- **Password Hashing**: bcrypt with salt rounds 12
- **CORS**: Configured for specific origins
- **Input Validation**: express-validator for request validation
- **File Upload Limits**: 1GB limit for audio files
- **Environment Variables**: No hardcoded secrets

### Performance
- **Database Indexes**: Optimized indexes for common queries
- **Pagination**: All list endpoints support pagination
- **Caching**: Response caching in mobile app (5-minute TTL)
- **Background Jobs**: Heavy operations run asynchronously
- **Request Deduplication**: Prevents duplicate API calls
- **Lazy Loading**: Dynamic imports for heavy modules

---

## 7. Deployment & Infrastructure

### Backend
- **Server**: Node.js on Linux (AWS)
- **Database**: MongoDB (likely MongoDB Atlas or self-hosted)
- **Storage**: AWS S3 for audio files
- **Queue**: Redis for Bull queues
- **HTTPS**: SSL/TLS enabled
- **Load Balancer**: Nginx (likely) for reverse proxy

### Frontend
- **Build**: Vite production build
- **Hosting**: Served via Nginx
- **CDN**: Static assets likely served via CDN
- **SEO**: Environment-based SEO indexing control

### Mobile App
- **Build**: Expo EAS Build
- **Distribution**: APK for Android
- **Updates**: App update service for OTA updates
- **Analytics**: Google Analytics integration

---

## 8. Key Integrations

### CATI Providers
- **CloudTelephony**: Phone call provider
- **DeepCall**: Phone call provider
- **Webhook System**: Receives call events from providers

### AWS Services
- **S3**: Audio file storage
- **Signed URLs**: Secure audio file access

### Analytics
- **Google Analytics**: Mobile app analytics
- **Custom Analytics**: Survey analytics and performance metrics

---

## 9. Development Workflow

### Backend
- **Entry Point**: `server.js`
- **Environment**: `.env` file with MongoDB URI, JWT secret, etc.
- **Development**: `npm run dev` (nodemon)
- **Production**: `npm start` (PM2 likely)

### Frontend
- **Development**: `npm run dev` (Vite dev server)
- **Build**: `npm run build` (Vite production build)
- **SEO Toggle**: `npm run seo:dev` / `npm run seo:prod`

### Mobile App
- **Development**: `npm start` (Expo dev server)
- **Tunnel**: `npm run start:tunnel` (for testing)
- **Build**: `npm run build:apk` (EAS build)

---

## 10. Common Issues & Solutions

### Audio Upload
- **Issue**: Large audio files cause memory issues
- **Solution**: Stream-based upload, S3 direct upload

### Duplicate Responses
- **Issue**: Offline sync creates duplicates
- **Solution**: Content hash-based duplicate detection

### Performance
- **Issue**: Slow queries on large datasets
- **Solution**: Database indexes, pagination, caching

### Offline Sync
- **Issue**: Data conflicts during sync
- **Solution**: Conflict resolution, last-write-wins with validation

---

## Summary

The Opine platform is a sophisticated market research platform with:
- **Web Application**: For admins, project managers, and quality agents
- **Mobile Application**: For field interviewers conducting CAPI/CATI interviews
- **Backend API**: RESTful API with MongoDB, S3, Redis
- **Key Features**: Survey management, response collection, quality control, analytics
- **Architecture**: MERN stack (web) + React Native (mobile)
- **Integration**: CATI providers, AWS S3, analytics

The system handles:
- Multi-mode surveys (CAPI, CATI, Online)
- Offline data collection and sync
- Quality control batch processing
- Performance tracking and analytics
- Audio recording and storage
- GPS location tracking
- Duplicate detection and prevention





