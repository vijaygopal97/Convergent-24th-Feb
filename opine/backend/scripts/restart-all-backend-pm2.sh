#!/bin/bash
# Restart all Opine backend PM2 processes (use on any backend server)
# Usage: ./restart-all-backend-pm2.sh   or   bash restart-all-backend-pm2.sh

set -e
cd /var/www/opine/backend 2>/dev/null || cd "$(dirname "$0")/.." || { echo "Could not find opine backend dir"; exit 1; }

echo "Saving PM2 process list..."
pm2 save

echo "Restarting opine-backend..."
pm2 restart opine-backend --update-env

sleep 3
echo "Restarting opine-cati-call-worker..."
pm2 restart opine-cati-call-worker --update-env

echo "Restarting opine-csv-worker..."
pm2 restart opine-csv-worker --update-env

sleep 2
pm2 save
echo ""
echo "PM2 status:"
pm2 list

echo ""
echo "Done. All backend processes restarted."
