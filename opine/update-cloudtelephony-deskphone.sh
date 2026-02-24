#!/bin/bash

# CloudTelephony Deskphone Number Update Script
# Usage: ./update-cloudtelephony-deskphone.sh <NEW_NUMBER>
# Example: ./update-cloudtelephony-deskphone.sh 917316525612

if [ -z "$1" ]; then
    echo "❌ Error: Please provide the new deskphone number"
    echo "Usage: $0 <NEW_NUMBER>"
    echo "Example: $0 917316525612"
    exit 1
fi

NEW_NUMBER="$1"
OLD_NUMBER_WITHOUT_91="${NEW_NUMBER#91}"  # Remove 91 prefix if present
OLD_NUMBER_WITHOUT_91="${OLD_NUMBER_WITHOUT_91#0}"  # Remove leading 0 if present

# Validate number format (should be 10-12 digits)
if ! [[ "$NEW_NUMBER" =~ ^[0-9]{10,12}$ ]]; then
    echo "❌ Error: Invalid number format. Number should be 10-12 digits"
    echo "Example: 917316525612 or 17316525612"
    exit 1
fi

echo "=========================================="
echo "Updating CloudTelephony Deskphone Number"
echo "=========================================="
echo "New Number: $NEW_NUMBER"
echo ""

BACKEND_DIR="/var/www/opine/backend"
PROVIDER_FILE="$BACKEND_DIR/services/catiProviders/cloudtelephonyProvider.js"
ENV_FILE="$BACKEND_DIR/.env"
TEST_SCRIPT="/var/www/opine/CLOUDTELEPHONY_TEST_CALL.sh"

# 1. Update .env file
echo "1. Updating .env file..."
if [ -f "$ENV_FILE" ]; then
    sed -i "s/CLOUDTELEPHONY_DESKPHONE=.*/CLOUDTELEPHONY_DESKPHONE=$NEW_NUMBER/" "$ENV_FILE"
    echo "   ✅ Updated: $ENV_FILE"
    grep "CLOUDTELEPHONY_DESKPHONE" "$ENV_FILE"
else
    echo "   ⚠️  Warning: .env file not found at $ENV_FILE"
fi
echo ""

# 2. Update cloudtelephonyProvider.js - default fallback
echo "2. Updating cloudtelephonyProvider.js (default fallback)..."
if [ -f "$PROVIDER_FILE" ]; then
    # Update the default fallback value
    sed -i "s/let deskphone = config\.deskphone || process\.env\.CLOUDTELEPHONY_DESKPHONE || '[0-9]*';/let deskphone = config.deskphone || process.env.CLOUDTELEPHONY_DESKPHONE || '$NEW_NUMBER';/" "$PROVIDER_FILE"
    
    # Update the forced replacement value
    sed -i "s/deskphone = '[0-9]*';/deskphone = '$NEW_NUMBER';/" "$PROVIDER_FILE"
    
    echo "   ✅ Updated: $PROVIDER_FILE"
    echo "   Verifying changes:"
    grep -A 1 "let deskphone = config.deskphone" "$PROVIDER_FILE" | head -2
else
    echo "   ⚠️  Warning: Provider file not found at $PROVIDER_FILE"
fi
echo ""

# 3. Update test script
echo "3. Updating test script..."
if [ -f "$TEST_SCRIPT" ]; then
    sed -i "s/DESKPHONE=\"[0-9]*\"/DESKPHONE=\"$NEW_NUMBER\"/" "$TEST_SCRIPT"
    echo "   ✅ Updated: $TEST_SCRIPT"
    grep "DESKPHONE=" "$TEST_SCRIPT"
else
    echo "   ⚠️  Warning: Test script not found at $TEST_SCRIPT"
fi
echo ""

# 4. Add old number to detection list (optional - user can manually add if needed)
echo "4. Note: If you want to add the previous number to old number detection,"
echo "   manually edit $PROVIDER_FILE and add it to the old number check list"
echo ""

echo "=========================================="
echo "✅ Update Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart backend services:"
echo "   cd $BACKEND_DIR && pm2 restart opine-backend opine-cati-call-worker"
echo ""
echo "2. Restart secondary servers (if needed):"
echo "   ssh -i /var/www/MyLogos/Convergent-New.pem ubuntu@3.109.82.159 'cd $BACKEND_DIR && pm2 restart opine-backend opine-cati-call-worker'"
echo "   ssh -i /var/www/MyLogos/Convergent-New.pem ubuntu@65.0.72.91 'cd $BACKEND_DIR && pm2 restart opine-backend opine-cati-call-worker'"
echo ""


