# Opine Platform - Complete Architecture Documentation

## Overview

The Opine platform is a comprehensive **MERN Stack** (MongoDB, Express.js, React, Node.js) market research platform with a connected **React Native** mobile application. The platform connects market research companies with verified field interviewers across India for conducting surveys.

---

## Project Structure

### 1. Backend (`/var/www/opine/backend`)
**Technology Stack:**
- Node.js with Express.js
- MongoDB with Mongoose (Replica Set Configuration)
- JWT Authentication
- BullMQ for job queues
- AWS S3 for file storage
- Multiple CATI (Computer-Assisted Telephone Interviewing) providers

**Key Features:**
- RESTful API with comprehensive endpoints
- Multi-tenant architecture (Company-based)
- Role-based access control (Super Admin, Company Admin, Project Manager, Interviewer, Quality Agent, Data Analyst)
- Real-time survey response collection
- CATI call management with webhook support
- Quality Control (QC) batch processing
- Performance analytics and reporting
- Background job processing
- Audio recording proxy and S3 integration

**Main Components:**

#### Models (`/backend/models/`)
- **User.js**: Comprehensive user model with roles, authentication, profile, performance metrics
- **Survey.js**: Survey configuration with multi-mode support (CAPI, CATI, Online, Multi-mode)
- **SurveyResponse.js**: Interview responses with session tracking, status management
- **CatiCall.js**: CATI call tracking and webhook handling
- **CatiRespondentQueue.js**: Queue management for CATI interviews
- **QCBatch.js**: Quality control batch processing
- **Company.js**: Multi-tenant company management
- **AvailableAssignment.js**: Survey assignment management
- **InterviewSession.js**: Session tracking for interviews

#### Routes (`/backend/routes/`)
- `/api/auth` - Authentication and user management
- `/api/surveys` - Survey CRUD operations
- `/api/survey-responses` - Response collection and management
- `/api/cati` - CATI call management
- `/api/cati-interview` - CATI interview flow
- `/api/qc-batches` - Quality control batch processing
- `/api/performance` - Performance analytics
- `/api/reports` - Report generation
- `/api/polling-stations` - Polling station data
- `/api/master-data` - Master data (ACs, MPs, MLAs)
- `/api/app-logs` - Mobile app logging
- `/api/app` - App update management

#### Services (`/backend/services/`)
- **catiProviders/**: CATI provider integrations
  - `cloudtelephonyProvider.js` - CloudTelephony (RP Digital Phone) integration
  - `baseProvider.js` - Base provider class
  - `deepcallProvider.js` - DeepCall integration

#### Background Jobs (`/backend/jobs/`)
- `startBackgroundJobs.js` - Materialized view updates
- `qcBatchProcessor.js` - QC batch processing
- `csvGenerator.js` - CSV generation for reports
- `updateAvailableAssignments.js` - Assignment updates
- `updateCatiPriorityQueue.js` - CATI queue management

#### Key Features:
1. **MongoDB Replica Set**: Configured with `secondaryPreferred` read preference for load balancing
2. **Memory Leak Prevention**: Request body size limits for webhooks, memory monitoring middleware
3. **Global Error Handlers**: Prevents crashes from unhandled rejections
4. **CORS Configuration**: Supports multiple origins including mobile app
5. **File Upload**: Supports up to 800MB files (Excel, audio recordings)
6. **Health Check Endpoint**: Fast health check for load balancers

---

### 2. Frontend (`/var/www/opine/frontend`)
**Technology Stack:**
- React 19 with Vite
- React Router v7
- Tailwind CSS
- Chart.js for analytics
- React Helmet Async for SEO management
- Axios for API communication

**Key Features:**
- Multi-role dashboard (Company Admin, Project Manager, Quality Agent, Data Analyst)
- Survey creation and management
- Real-time analytics and reporting
- Response review and approval workflow
- CSV export with filtering
- SEO management system
- Responsive design with Tailwind CSS

**Main Components:**
- Authentication (Login, Register, Forgot Password)
- Dashboard components for each role
- Survey management (Create, Edit, Assign, Publish)
- Response viewing and approval
- Analytics dashboards with charts
- QC batch management
- Performance tracking

**API Integration:**
- Centralized API service (`/src/services/api.js`)
- JWT token management
- Request/response interceptors
- Error handling and retry logic

---

### 3. React Native App (`/var/www/Opine-Android`)
**Technology Stack:**
- React Native 0.81.5
- Expo SDK ~54.0.30
- TypeScript
- React Navigation v7
- React Native Paper (Material Design)
- Expo Location, Expo AV, Expo File System

**Key Features:**
- Native GPS location tracking
- Audio recording for CAPI interviews
- Offline data caching and synchronization
- Network condition emulation for testing
- Performance caching
- App update management
- Analytics tracking

**Main Screens:**
- `LoginScreen.tsx` - Authentication
- `InterviewerDashboard.tsx` - Dashboard for interviewers
- `QualityAgentDashboard.tsx` - Dashboard for quality agents
- `AvailableSurveys.tsx` - Browse available surveys
- `MyInterviews.tsx` - View interview history
- `InterviewInterface.tsx` - Conduct interviews (CAPI/CATI)
- `InterviewDetails.tsx` - View interview details

**Services:**
- `api.ts` - Centralized API service with offline support
- `offlineStorage.ts` - Local data persistence
- `offlineDataCache.ts` - Offline data caching
- `performanceCache.ts` - Performance optimization cache
- `syncService.ts` - Data synchronization
- `analyticsService.ts` - Analytics tracking
- `appUpdateService.ts` - App update management

**API Connection:**
- Base URL: `https://convo.convergentview.com` (production)
- Alternative: `https://opine.exypnossolutions.com`
- JWT token stored in AsyncStorage
- Automatic token refresh
- Offline mode support with sync

---

## Data Flow & Architecture

### Authentication Flow
1. **Web Frontend**: User logs in → JWT token stored in localStorage → Token sent in Authorization header
2. **Mobile App**: User logs in → JWT token stored in AsyncStorage → Token sent in Authorization header
3. **Backend**: Validates JWT → Returns user data with role-based permissions

### Survey Flow
1. **Creation**: Company Admin/Project Manager creates survey via web frontend
2. **Assignment**: Survey assigned to interviewers (CAPI) or added to CATI queue
3. **Conduction**: 
   - **CAPI**: Interviewer uses mobile app → GPS location captured → Audio recorded → Responses saved
   - **CATI**: Interviewer uses web interface → Call made via CATI provider → Responses collected
4. **Review**: Quality Agent reviews responses → Approves/Rejects
5. **Analytics**: Data aggregated for reports and analytics

### CATI Call Flow
1. Interviewer starts CATI interview → Backend creates queue entry
2. Backend initiates call via provider (CloudTelephony/DeepCall)
3. Provider makes call → Webhook received → Call status updated
4. Interviewer collects responses → Completes interview
5. Response saved with call metadata

### Data Synchronization
- **Mobile App**: Offline-first architecture
  - Data cached locally using AsyncStorage
  - Sync service syncs when online
  - Conflict resolution for concurrent edits
- **Web Frontend**: Real-time updates via API calls

---

## Database Schema

### Key Collections:
1. **Users**: Multi-role user management with profiles, performance metrics
2. **Surveys**: Survey configuration with questions, assignments, quotas
3. **SurveyResponses**: Interview responses with session tracking
4. **CatiCalls**: Call tracking and webhook data
5. **CatiRespondentQueues**: Queue management for CATI
6. **QCBatches**: Quality control batch processing
7. **Companies**: Multi-tenant company data
8. **AvailableAssignments**: Survey assignment tracking

### Relationships:
- User → Company (many-to-one)
- Survey → Company (many-to-one)
- SurveyResponse → Survey (many-to-one)
- SurveyResponse → User (Interviewer) (many-to-one)
- CatiCall → SurveyResponse (one-to-one)
- QCBatch → Survey (many-to-one)

---

## API Endpoints Summary

### Authentication
- `POST /api/auth/login` - Login (email/memberId + password)
- `POST /api/auth/register` - Register new user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgot-password` - Password reset

### Surveys
- `GET /api/surveys` - List surveys
- `POST /api/surveys` - Create survey
- `GET /api/surveys/:id` - Get survey details
- `PUT /api/surveys/:id` - Update survey
- `POST /api/surveys/:id/publish` - Publish survey
- `GET /api/surveys/available` - Get available surveys (mobile)

### Survey Responses
- `POST /api/survey-responses/start/:surveyId` - Start interview
- `POST /api/survey-responses/session/:sessionId/complete` - Complete interview
- `GET /api/survey-responses/my-interviews` - Get my interviews
- `GET /api/survey-responses/survey/:surveyId/responses-v2` - Get responses (paginated)
- `PATCH /api/survey-responses/:id/approve` - Approve response
- `PATCH /api/survey-responses/:id/reject` - Reject response

### CATI
- `POST /api/cati-interview/start/:surveyId` - Start CATI interview
- `POST /api/cati-interview/make-call/:queueId` - Make call
- `POST /api/cati-interview/complete/:queueId` - Complete CATI interview
- `POST /api/cati/webhook` - Webhook endpoint for call status

### Performance & Analytics
- `GET /api/performance/analytics` - Performance analytics
- `GET /api/surveys/:id/analytics-v2` - Survey analytics
- `GET /api/surveys/:id/ac-wise-stats-v2` - AC-wise statistics

---

## Deployment & Infrastructure

### Backend
- **Server**: Express.js on Node.js
- **Database**: MongoDB Atlas (Replica Set)
- **File Storage**: AWS S3
- **Job Queue**: BullMQ with Redis
- **Process Manager**: PM2 (ecosystem.config.js)
- **Load Balancer**: Nginx (multiple backend instances)
- **SSL**: HTTPS enabled

### Frontend
- **Build Tool**: Vite
- **Hosting**: Static files served via Nginx
- **SEO**: React Helmet Async with environment-based indexing

### Mobile App
- **Platform**: Expo (React Native)
- **Build**: EAS Build (Expo Application Services)
- **Distribution**: APK for Android
- **Updates**: Over-the-air updates via Expo

---

## Key Integrations

### CATI Providers
1. **CloudTelephony (RP Digital Phone)**
   - API v2 and v3 support
   - Basic Auth and Authcode authentication
   - Webhook-based call status updates
   - Click-to-call functionality

2. **DeepCall**
   - Webhook integration
   - Call tracking

### External Services
- **AWS S3**: Audio file storage and proxy
- **MongoDB Atlas**: Database hosting
- **Redis**: Job queue backend
- **Email**: Nodemailer for notifications

---

## Security Features

1. **Authentication**: JWT tokens with expiration
2. **Authorization**: Role-based access control (RBAC)
3. **Password Security**: bcrypt hashing (cost factor 12)
4. **CORS**: Configured for specific origins
5. **Input Validation**: Express-validator middleware
6. **File Upload**: Size limits and type validation
7. **HTTPS**: SSL/TLS encryption

---

## Performance Optimizations

### Backend
- MongoDB replica set with read preference
- Indexed database queries
- Aggregation pipelines for analytics
- Materialized views for fast lookups
- Background job processing
- Request deduplication
- Memory leak prevention

### Frontend
- Code splitting with Vite
- Lazy loading components
- Optimized API calls with caching
- Debounced search inputs

### Mobile App
- Offline-first architecture
- Performance caching
- Request deduplication
- Optimized image loading
- Background sync

---

## Development Workflow

### Backend Development
```bash
cd /var/www/opine/backend
npm install
cp .env.sample .env
# Edit .env with MongoDB URI, JWT secret, etc.
npm run dev  # Uses nodemon for auto-reload
```

### Frontend Development
```bash
cd /var/www/opine/frontend
npm install
cp .env.sample .env
# Edit .env with API URL
npm run dev  # Vite dev server
```

### Mobile App Development
```bash
cd /var/www/Opine-Android
npm install
npm run start:tunnel  # Expo with tunnel for testing
```

---

## Environment Variables

### Backend (.env)
- `MONGODB_URI` - MongoDB connection string
- `PORT` - Server port (default: 5000)
- `JWT_SECRET` - JWT signing secret
- `CORS_ORIGIN` - Allowed CORS origins
- `AWS_ACCESS_KEY_ID` - AWS S3 access key
- `AWS_SECRET_ACCESS_KEY` - AWS S3 secret
- `CLOUDTELEPHONY_API_USERNAME` - CATI provider credentials
- `CLOUDTELEPHONY_API_PASSWORD` - CATI provider credentials

### Frontend (.env)
- `VITE_API_BASE_URL` - Backend API URL
- `VITE_ENABLE_SEO_INDEXING` - SEO control

### Mobile App
- Hardcoded: `API_BASE_URL = 'https://convo.convergentview.com'`

---

## Testing & Monitoring

### Backend
- Health check endpoint: `/health`
- Memory monitoring middleware
- Request logging
- Error tracking
- Load testing scripts

### Mobile App
- Network condition emulation
- Offline mode testing
- Performance monitoring
- Analytics tracking

---

## Future Enhancements

Based on codebase analysis:
- [ ] User authentication system improvements
- [ ] Real-time chat functionality
- [ ] Payment integration
- [ ] Advanced analytics
- [ ] Mobile app for iOS
- [ ] Push notifications
- [ ] Multi-language support expansion

---

## Support & Documentation

- Backend API documentation: See route files in `/backend/routes/`
- Frontend component docs: See component files in `/frontend/src/components/`
- Mobile app docs: See README.md in `/Opine-Android/`
- Deployment guides: Multiple .md files in root directory

---

**Last Updated**: January 2025
**Platform Version**: Production
**Maintainer**: Opine Development Team

















