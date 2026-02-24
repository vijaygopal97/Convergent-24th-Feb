/**
 * CloudTelephony (RP Digital Phone) Provider Implementation
 */
const axios = require('axios');
const BaseProvider = require('./baseProvider');

// CloudTelephony (RP Digital Phone) endpoints
const CLOUDTELEPHONY_API_BASE_URL_V2 = 'https://indiavoice.rpdigitalphone.com/api/click_to_call_v2';
const CLOUDTELEPHONY_API_BASE_URL_V3 = 'https://indiavoice.rpdigitalphone.com/api_v3/click_to_call_v2';
// Member APIs
const CLOUDTELEPHONY_ADD_MEMBER_API_V3 = 'https://indiavoice.rpdigitalphone.com/api_v3/addmember_v2';
const CLOUDTELEPHONY_ADD_MEMBER_API_V2 = 'https://indiavoice.rpdigitalphone.com/api_v2/addmember_v2';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'https://convo.convergentview.com';

class CloudTelephonyProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.apiBaseUrlV2 = CLOUDTELEPHONY_API_BASE_URL_V2;
    this.apiBaseUrlV3 = CLOUDTELEPHONY_API_BASE_URL_V3;
    this.addMemberApiUrlV3 = CLOUDTELEPHONY_ADD_MEMBER_API_V3;
    this.addMemberApiUrlV2 = CLOUDTELEPHONY_ADD_MEMBER_API_V2;
    // v3: Basic Auth credentials (preferred)
    this.apiUsername = config.apiUsername || process.env.CLOUDTELEPHONY_API_USERNAME || null;
    this.apiPassword = config.apiPassword || process.env.CLOUDTELEPHONY_API_PASSWORD || null;

    // v2: legacy authcode (fallback)
    this.authCode = config.authCode || process.env.CLOUDTELEPHONY_AUTH_CODE || null;

    // Get deskphone from config, env, or fallback
    let deskphone = config.deskphone || process.env.CLOUDTELEPHONY_DESKPHONE || '919228812714';
    
    // CRITICAL: Check if this is the old number (in any format) and replace with new number
    // Remove leading zeros for comparison to catch old number in any format
    const cleanDeskphone = deskphone.replace(/^0+/, ''); // Remove leading zeros
    if (cleanDeskphone === '917316525610' || cleanDeskphone === '17316525610' ||
        cleanDeskphone === '917316525609' || cleanDeskphone === '17316525609' || 
        cleanDeskphone === '917316525608' || cleanDeskphone === '17316525608' ||
        cleanDeskphone === '917316525611' || cleanDeskphone === '17316525611' ||
        cleanDeskphone === '917316525612' || cleanDeskphone === '17316525612' ||
        cleanDeskphone === '917316525613' || cleanDeskphone === '17316525613' ||
        cleanDeskphone === '919228812714' || cleanDeskphone === '19228812714' ||
        cleanDeskphone === '917316525615' || cleanDeskphone === '17316525615') {
      // This is an old number - force use the new number (don't check env as it might be old)
      deskphone = '919228812714';
      console.log(`⚠️ [CloudTelephony] Old deskphone number detected (${config.deskphone || process.env.CLOUDTELEPHONY_DESKPHONE || 'N/A'}), forcing use of new number: ${deskphone}`);
    }
    
    // NOTE: We're using the number WITHOUT "00" prefix as requested
    // Cloud Telephony API should handle the number format as provided
    this.deskphone = deskphone;
  }

  getName() {
    return 'cloudtelephony';
  }

  /**
   * Register an agent (member) in CloudTelephony system
   * This must be called before making calls with this agent
   */
  async registerAgent(agentNumber, agentName) {
    try {
      const FormData = require('form-data');
      const formData = new FormData();
      
      formData.append('member_name', agentName || agentNumber);
      formData.append('member_num', agentNumber.replace(/[^0-9]/g, ''));
      formData.append('access', '2'); // 2 = regular member
      formData.append('active', '1'); // 1 = active

      console.log(`📝 [CloudTelephony] Registering agent: ${agentNumber}`);

      let response;

      // v3: Basic Auth (preferred)
      if (this.apiUsername && this.apiPassword) {
        response = await axios.post(this.addMemberApiUrlV3, formData, {
          headers: formData.getHeaders(),
          timeout: 60000,
          auth: { username: this.apiUsername, password: this.apiPassword }
        });
      } else {
        // v2 fallback: requires Authcode in body
        if (!this.authCode) {
          throw new Error('CloudTelephony credentials missing: set CLOUDTELEPHONY_API_USERNAME/PASSWORD for v3 or CLOUDTELEPHONY_AUTH_CODE for v2');
        }
        formData.append('Authcode', this.authCode);
        response = await axios.post(this.addMemberApiUrlV2, formData, {
        headers: formData.getHeaders(),
        timeout: 60000
      });
      }

      const data = response.data;
      // Provider often returns HTTP 200 even for errors
      if (data && typeof data === 'object' && String(data.type || '').toLowerCase() === 'error') {
        throw new Error(data.message || 'CloudTelephony agent registration failed');
      }

      console.log(`✅ [CloudTelephony] Agent registered: ${agentNumber}`);
      return { success: true, response: data };
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      const msg = (typeof data === 'string' ? data : (data?.message || data?.error || '')) || error.message;

      // Idempotency: many providers return 4xx when member already exists.
      if (status === 409 || (typeof msg === 'string' && msg.toLowerCase().includes('already'))) {
        console.log(`ℹ️  [CloudTelephony] Agent already registered: ${agentNumber}`);
        return { success: true, alreadyRegistered: true, response: data };
      }

      console.error(`❌ [CloudTelephony] Agent registration failed: ${error.message}`);
      throw error;
    }
  }

  async makeCall(callParams) {
    const { fromNumber, toNumber, fromRingTime, timeLimit, uid } = callParams;
    
    // Clean phone numbers
    const cleanFrom = fromNumber.replace(/[^0-9]/g, '');
    const cleanTo = toNumber.replace(/[^0-9]/g, '');

    // Build API parameters - match exact format of working CURL request
    const params = {
      calling_party_a: cleanFrom, // Agent (FROM number)
      calling_party_b: cleanTo,   // Respondent (TO number)
      deskphone: this.deskphone,
      call_from_did: '1' // Always 1 (mandatory)
    };

    // NOTE: Removed optional parameters (waittime, CallLimit, uid) to match working CURL format
    // These may cause "No Callgroup" errors - only include if absolutely necessary
    // if (fromRingTime) params.waittime = parseInt(fromRingTime);
    // if (timeLimit) params.CallLimit = parseInt(timeLimit);
    // if (uid) params.uid = String(uid);

    const queryString = new URLSearchParams(params).toString();
    const fullUrl = `${(this.apiUsername && this.apiPassword) ? this.apiBaseUrlV3 : this.apiBaseUrlV2}?${queryString}${(this.apiUsername && this.apiPassword) ? '' : `&authcode=${encodeURIComponent(this.authCode || '')}`}`;

    console.log(`📞 [CloudTelephony] Making call: ${fromNumber} -> ${toNumber}`);
    console.log(`📞 [CloudTelephony] Using deskphone: ${this.deskphone} (from config: ${callParams.config?.deskphone || 'N/A'}, env: ${process.env.CLOUDTELEPHONY_DESKPHONE || 'N/A'})`);
    console.log(`📞 [CloudTelephony] API URL: ${fullUrl}`);
    console.log(`📞 [CloudTelephony] Parameters: ${JSON.stringify(params, null, 2)}`);
    console.log(`📞 [CloudTelephony] Using Auth: ${this.apiUsername && this.apiPassword ? 'Basic Auth (V3)' : 'Authcode (V2)'}`);

    const axiosOptions = {
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    // v3 requires Basic Auth
    if (this.apiUsername && this.apiPassword) {
      axiosOptions.auth = { username: this.apiUsername, password: this.apiPassword };
    } else {
      if (!this.authCode) {
        throw new Error('CloudTelephony credentials missing: set CLOUDTELEPHONY_API_USERNAME/PASSWORD for v3 or CLOUDTELEPHONY_AUTH_CODE for v2');
      }
    }

    const response = await axios.get(fullUrl, axiosOptions);

    const apiResponse = response.data;
    
    console.log(`📞 [CloudTelephony] API Response Status: ${response.status}`);
    console.log(`📞 [CloudTelephony] API Response Data: ${JSON.stringify(apiResponse, null, 2)}`);
    
    // Provider can return HTTP 200 with an error payload
    if (apiResponse && typeof apiResponse === 'object' && String(apiResponse.type || '').toLowerCase() === 'error') {
      const errorMsg = apiResponse.message || 'CloudTelephony click-to-call failed';
      console.error(`❌ [CloudTelephony] API returned error: ${errorMsg}`);
      throw new Error(errorMsg);
    }
    if (typeof apiResponse === 'string' && apiResponse.toLowerCase().includes('error')) {
      console.error(`❌ [CloudTelephony] API returned error string: ${apiResponse}`);
      throw new Error(apiResponse);
    }
    
    // CloudTelephony call identifier (best-effort)
    // Prefer provider-provided call id; if absent, fall back to uid (so webhook correlation still works).
    const callIdFromResponse =
      apiResponse?.CallSid ||
      apiResponse?.callSid ||
      apiResponse?.callId ||
      apiResponse?.call_id ||
      apiResponse?.id ||
      // Observed v3 click2call success payloads use campid/Uniqueid for call identifier
      apiResponse?.campid ||
      apiResponse?.Uniqueid ||
      apiResponse?.uniqueid;

    const callId = callIdFromResponse || uid;

    if (!callId) {
      // Do NOT synthesize a fake call id; that masks provider failures.
      // If provider doesn't return an id and no uid was provided, treat as failure.
      throw new Error('CloudTelephony response did not include call identifier (CallSid/callId) and no uid was provided');
    }

    return {
      callId,
      apiResponse,
      provider: 'cloudtelephony'
    };
  }

  normalizeWebhookData(webhookData, method, query, body) {
    // CloudTelephony sends GET request with query parameters
    // Convert query parameters to normalized format
    
    if (method === 'GET' && query) {
      // CloudTelephony semantics (per vendor report):
      // - SourceNumber: customer/respondent number
      // - DestinationNumber: deskphone/DID
      // - DialWhomNumber: agent number (who answered / whom it dialed)
      const sourceNumber = query.SourceNumber || query.Source_Number || query.fromNumber || query.From;
      const dialWhomNumber =
        query['Dial Whom Number'] ||
        query.DialWhomNumber ||
        query.Dial_Whom_Number ||
        query.dialWhomNumber ||
        query.AnsweredNumber;
      const destinationNumber =
        query['Destination Number'] ||
        query.DestinationNumber ||
        query.Destination_Number ||
        query.destinationNumber ||
        query.To;

      const normalized = {
        // Call identification
        callId: query.CallSid || query.Call_Sid || query.callId || query.call_id || query.campid || query.Uniqueid,
        uid: query.uid || query.UID || query.Uid || query.client_uid || query.ClientUid || query.campid || query.Uniqueid,
        
        // Phone numbers
        // Map to our internal semantics (match DeepCall):
        // fromNumber = interviewer/agent
        // toNumber   = respondent/customer
        fromNumber: dialWhomNumber || sourceNumber,
        toNumber: sourceNumber,
        answeredNumber:
          query['Dial Whom Number'] ||
          query.DialWhomNumber ||
          query.Dial_Whom_Number ||
          query.dialWhomNumber ||
          query.AnsweredNumber,
        deskphoneNumber: destinationNumber,
        
        // Status
        status: query.Status || query.status || 'ANSWER',
        callStatus: this.normalizeStatus(query.Status || query.status),
        
        // Timing
        callDuration: parseInt(query['Call Duration'] || query.CallDuration || query.Call_Duration || query.callDuration || '0', 10),
        startTime: query.StartTime || query.Start_Time || query.startTime,
        endTime: query['End Time'] || query.EndTime || query.End_Time || query.endTime,
        
        // Recording
        recordingUrl: query.CallRecordingUrl || query.Call_Recording_Url || query.callRecordingUrl || query.recordingUrl,
        
        // Direction
        direction: query.Direction || query.direction || 'IVR',
        
        // Original query data
        rawWebhookData: query
      };
      
      return normalized;
    }
    
    // If POST or other format, return as-is
    return webhookData || query || body || {};
  }

  normalizeStatus(status) {
    if (!status) return 'completed';
    
    const statusLower = status.toString().toLowerCase();
    if (statusLower.includes('answer')) return 'answered';
    if (statusLower.includes('busy')) return 'busy';
    if (statusLower.includes('no') || statusLower.includes('unans')) return 'no-answer';
    if (statusLower.includes('cancel')) return 'cancelled';
    if (statusLower.includes('fail')) return 'failed';
    return 'completed';
  }
}

module.exports = CloudTelephonyProvider;
