#!/bin/bash
# Monitor download directory and process files as they arrive

DOWNLOAD_DIR="/var/www/Report-Generation/master_data"
LOG_FILE="/tmp/download_monitor.log"

echo "Monitoring $DOWNLOAD_DIR for new files..."
echo "Log: $LOG_FILE"

while true; do
    count=$(find "$DOWNLOAD_DIR" -name "ac*.xlsx" -o -name "ac*.csv" 2>/dev/null | wc -l)
    echo "$(date): Found $count files" >> "$LOG_FILE"
    sleep 10
done
