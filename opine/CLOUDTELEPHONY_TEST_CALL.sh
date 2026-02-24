#!/bin/bash

# CloudTelephony Click-to-Call API Test
# From: 9958011332 (Agent)
# To: 9958088812 (Respondent)

# API Configuration
API_BASE_URL="https://indiavoice.rpdigitalphone.com/api_v3/click_to_call_v2"
API_USERNAME="ee8dc3-e37992-7aeb5c-ac5375-35a255"
API_PASSWORD="33cce6-b27274-70480b-a1b26d-9af405"
DESKPHONE="919228812714"

# Call Parameters
CALLING_PARTY_A="9958011332"  # Agent (FROM number)
CALLING_PARTY_B="9958088812"  # Respondent (TO number)
CALL_FROM_DID="1"              # Always 1 (mandatory)

# Build URL with query parameters
FULL_URL="${API_BASE_URL}?calling_party_a=${CALLING_PARTY_A}&calling_party_b=${CALLING_PARTY_B}&deskphone=${DESKPHONE}&call_from_did=${CALL_FROM_DID}"

echo "=========================================="
echo "CloudTelephony Click-to-Call API Test"
echo "=========================================="
echo ""
echo "API URL: ${FULL_URL}"
echo ""
echo "Parameters:"
echo "  calling_party_a (Agent): ${CALLING_PARTY_A}"
echo "  calling_party_b (Respondent): ${CALLING_PARTY_B}"
echo "  deskphone: ${DESKPHONE}"
echo "  call_from_did: ${CALL_FROM_DID}"
echo ""
echo "Authentication: Basic Auth (V3)"
echo "  Username: ${API_USERNAME}"
echo "  Password: ${API_PASSWORD}"
echo ""
echo "=========================================="
echo "Making API call..."
echo "=========================================="
echo ""

# Make the API call using curl with Basic Auth
curl -X GET "${FULL_URL}" \
  -u "${API_USERNAME}:${API_PASSWORD}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -v

echo ""
echo ""
echo "=========================================="
echo "API call completed"
echo "=========================================="


