const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const REVIEWER_EMAIL = 'ajayadarsh@gmail.com';
const TODAY = new Date('2026-02-06T00:00:00Z');

async function checkSecondary() {
  try {
    // First, get our reviewer ID from primary
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to PRIMARY');
    
    const ourReviewer = await User.findOne({ email: REVIEWER_EMAIL });
    if (!ourReviewer) {
      throw new Error(`Reviewer not found: ${REVIEWER_EMAIL}`);
    }
    const ourReviewerId = ourReviewer._id.toString();
    console.log(`✅ Found reviewer: ${REVIEWER_EMAIL} (ID: ${ourReviewerId})`);
    
    // Get list of responses updated today (from primary)
    const updatedToday = await SurveyResponse.find({
      'verificationData.reviewer': ourReviewer._id,
      'verificationData.reviewedAt': { $gte: TODAY }
    }).select('responseId').limit(100).lean();
    
    console.log(`\n📊 Found ${updatedToday.length} responses updated today on PRIMARY`);
    
    // Now try to connect to secondary
    const uri = process.env.MONGODB_URI;
    // Extract secondary host from URI (second host in the list)
    const uriParts = uri.match(/mongodb:\/\/([^@]+)@([^\/]+)\/(.+)/);
    if (!uriParts) {
      throw new Error('Could not parse MongoDB URI');
    }
    
    const credentials = uriParts[1];
    const hosts = uriParts[2].split(',');
    const dbName = uriParts[3].split('?')[0];
    const options = uriParts[3].split('?')[1] || '';
    
    // Try to connect to first secondary
    const secondaryHost = hosts.find(h => !h.includes('172.31.43.71')) || hosts[1];
    const secondaryUri = `mongodb://${credentials}@${secondaryHost}/${dbName}?${options}&readPreference=secondaryPreferred`;
    
    console.log(`\n🔍 Attempting to connect to secondary: ${secondaryHost}...`);
    
    try {
      const secondaryConn = await mongoose.createConnection(secondaryUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 5000
      }).asPromise();
      
      console.log('✅ Connected to SECONDARY');
      
      const SecondarySurveyResponse = secondaryConn.model('SurveyResponse', SurveyResponse.schema);
      
      // Check a few sample responses
      console.log('\n📋 Checking sample responses on SECONDARY...');
      let foundOriginal = 0;
      const originalReviewers = new Map(); // responseId -> reviewer info
      
      for (const response of updatedToday.slice(0, 10)) {
        const secondaryResponse = await SecondarySurveyResponse.findOne({ responseId: response.responseId })
          .populate('verificationData.reviewer', 'email')
          .select('responseId status verificationData.reviewer verificationData.reviewedAt verificationData.feedback')
          .lean();
        
        if (secondaryResponse) {
          const reviewedAt = secondaryResponse.verificationData?.reviewedAt;
          const reviewer = secondaryResponse.verificationData?.reviewer;
          const isFromToday = reviewedAt && new Date(reviewedAt) >= TODAY;
          
          if (!isFromToday && reviewer && reviewer._id.toString() !== ourReviewerId) {
            foundOriginal++;
            originalReviewers.set(response.responseId, {
              reviewerId: reviewer._id.toString(),
              reviewerEmail: reviewer.email,
              reviewedAt: reviewedAt,
              feedback: secondaryResponse.verificationData?.feedback
            });
            console.log(`  ✅ ${response.responseId}: Original reviewer = ${reviewer.email}`);
          }
        }
      }
      
      if (foundOriginal > 0) {
        console.log(`\n🎉 FOUND ${foundOriginal} responses with ORIGINAL reviewers on secondary!`);
        console.log('   We can recover the original reviewer data!');
        
        // Now check all responses
        console.log('\n📊 Checking ALL updated responses on secondary...');
        let totalWithOriginal = 0;
        const allOriginalReviewers = new Map();
        
        for (let i = 0; i < updatedToday.length; i += 100) {
          const batch = updatedToday.slice(i, i + 100);
          const responseIds = batch.map(r => r.responseId);
          
          const secondaryResponses = await SecondarySurveyResponse.find({
            responseId: { $in: responseIds }
          })
          .populate('verificationData.reviewer', 'email')
          .select('responseId verificationData.reviewer verificationData.reviewedAt verificationData.feedback')
          .lean();
          
          for (const secResponse of secondaryResponses) {
            const reviewedAt = secResponse.verificationData?.reviewedAt;
            const reviewer = secResponse.verificationData?.reviewer;
            const isFromToday = reviewedAt && new Date(reviewedAt) >= TODAY;
            
            if (!isFromToday && reviewer && reviewer._id.toString() !== ourReviewerId) {
              totalWithOriginal++;
              allOriginalReviewers.set(secResponse.responseId, {
                reviewerId: reviewer._id.toString(),
                reviewerEmail: reviewer.email,
                reviewedAt: reviewedAt,
                feedback: secResponse.verificationData?.feedback
              });
            }
          }
          
          if ((i + 100) % 1000 === 0) {
            console.log(`   Checked ${i + 100} responses, found ${totalWithOriginal} with original reviewers...`);
          }
        }
        
        console.log(`\n✅ Total responses with original reviewers on SECONDARY: ${totalWithOriginal}`);
        console.log(`   Out of ${updatedToday.length} responses checked`);
        
        if (totalWithOriginal > 0) {
          console.log('\n💾 Saving original reviewer data to file...');
          const fs = require('fs');
          const data = Array.from(allOriginalReviewers.entries()).map(([responseId, info]) => ({
            responseId,
            ...info
          }));
          
          fs.writeFileSync(
            '/tmp/original_reviewers.json',
            JSON.stringify(data, null, 2)
          );
          
          console.log(`✅ Saved ${data.length} original reviewer records to /tmp/original_reviewers.json`);
          console.log('\n📝 Next step: Restore these reviewers using the restore script');
        }
      } else {
        console.log('\n⚠️  Secondary also has today\'s updates');
        console.log('   This means the replica set has already synced');
        console.log('   Original reviewer data cannot be recovered from secondaries');
      }
      
      await secondaryConn.close();
    } catch (error) {
      console.error('❌ Error connecting to secondary:', error.message);
      console.log('   Trying alternative method...');
      
      // Alternative: Use readPreference in the main connection
      await mongoose.connection.close();
      
      const secondaryUri2 = process.env.MONGODB_URI.replace(
        /readPreference=[^&]*/,
        'readPreference=secondary'
      );
      
      if (!secondaryUri2.includes('readPreference')) {
        const separator = secondaryUri2.includes('?') ? '&' : '?';
        const newUri = `${secondaryUri2}${separator}readPreference=secondary`;
        await mongoose.connect(newUri);
        console.log('✅ Connected with readPreference=secondary');
        
        // Check responses
        const testResponse = await SurveyResponse.findOne({ responseId: updatedToday[0].responseId })
          .populate('verificationData.reviewer', 'email')
          .select('responseId verificationData.reviewer verificationData.reviewedAt')
          .lean();
        
        if (testResponse) {
          const reviewedAt = testResponse.verificationData?.reviewedAt;
          const isFromToday = reviewedAt && new Date(reviewedAt) >= TODAY;
          console.log(`\nTest response on secondary:`);
          console.log(`  Reviewer: ${testResponse.verificationData?.reviewer?.email || 'None'}`);
          console.log(`  Reviewed At: ${reviewedAt || 'None'}`);
          console.log(`  From Today: ${isFromToday ? 'YES' : 'NO'}`);
        }
      }
    }
    
    await mongoose.connection.close();
    console.log('\n✅ Check completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

checkSecondary();






