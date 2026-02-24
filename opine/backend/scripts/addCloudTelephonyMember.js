const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

async function addCloudTelephonyMember() {
  try {
    // Cloud Telephony API Configuration
    const API_BASE_URL_V3 = 'https://indiavoice.rpdigitalphone.com/api_v3/addmember_v2';
    const API_USERNAME = process.env.CLOUDTELEPHONY_API_USERNAME || 'ee8dc3-e37992-7aeb5c-ac5375-35a255';
    const API_PASSWORD = process.env.CLOUDTELEPHONY_API_PASSWORD || '33cce6-b27274-70480b-a1b26d-9af405';

    // Member details (same as caticati2018@gmail.com but with new phone)
    const memberName = 'Rumi Santra'; // Same name as caticati2018@gmail.com
    const memberNumber = '9205308529'; // New phone number
    const access = '2'; // 2 = regular member
    const active = '1'; // 1 = active

    console.log('==========================================');
    console.log('Cloud Telephony Add Member API');
    console.log('==========================================');
    console.log('');
    console.log('Member Details:');
    console.log(`  Name: ${memberName}`);
    console.log(`  Phone Number: ${memberNumber}`);
    console.log(`  Access Level: ${access} (Regular Member)`);
    console.log(`  Status: ${active} (Active)`);
    console.log('');

    // Create form data
    const formData = new FormData();
    formData.append('member_name', memberName);
    formData.append('member_num', memberNumber.replace(/[^0-9]/g, ''));
    formData.append('access', access);
    formData.append('active', active);

    console.log('API Endpoint:', API_BASE_URL_V3);
    console.log('Authentication: Basic Auth (V3)');
    console.log('');
    console.log('Making API call...');
    console.log('==========================================');
    console.log('');

    // Make API call
    const response = await axios.post(API_BASE_URL_V3, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: 60000,
      auth: {
        username: API_USERNAME,
        password: API_PASSWORD
      }
    });

    const data = response.data;

    console.log('✅ API Response Status:', response.status);
    console.log('✅ API Response Data:', JSON.stringify(data, null, 2));
    console.log('');

    // Check for errors in response
    if (data && typeof data === 'object' && String(data.type || '').toLowerCase() === 'error') {
      console.error('❌ Error in API response:', data.message || 'Unknown error');
      return;
    }

    // Check if member already exists
    if (response.status === 409 || (typeof data === 'string' && data.toLowerCase().includes('already'))) {
      console.log('ℹ️  Member already registered in Cloud Telephony');
      console.log('Response:', data);
      return;
    }

    console.log('✅ Member added successfully to Cloud Telephony!');
    console.log('');
    console.log('==========================================');
    console.log('Summary:');
    console.log('==========================================');
    console.log(`Member Name: ${memberName}`);
    console.log(`Member Number: ${memberNumber}`);
    console.log(`Member ID (if provided): ${data.member_id || data.memberId || 'N/A'}`);
    console.log(`Response: ${JSON.stringify(data)}`);

  } catch (error) {
    console.error('❌ Error adding member to Cloud Telephony:');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received:', error.message);
    } else {
      console.error('Error:', error.message);
    }
    
    // Check if member already exists
    const errorMsg = error.response?.data?.message || error.message || '';
    if (error.response?.status === 409 || errorMsg.toLowerCase().includes('already')) {
      console.log('');
      console.log('ℹ️  Member may already be registered in Cloud Telephony');
    }
    
    process.exit(1);
  }
}

addCloudTelephonyMember();











































