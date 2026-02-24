#!/bin/bash
# Script to download SharePoint files using browser automation
# This will be called to download files

DOWNLOAD_DIR="/var/www/Report-Generation/master_data"
mkdir -p "$DOWNLOAD_DIR"

echo "Download directory: $DOWNLOAD_DIR"
echo "Please use browser to download files to this directory"
echo "Files needed: 46 AC files (ac001.xlsx/csv through ac283.xlsx/csv)"

# List of files needed
FILES=(
    "ac001" "ac004" "ac008" "ac011" "ac014" "ac019" "ac021" "ac022" "ac023"
    "ac087" "ac088" "ac105" "ac112" "ac116" "ac123" "ac145" "ac152" "ac154"
    "ac155" "ac158" "ac159" "ac160" "ac161" "ac162" "ac163" "ac167" "ac168"
    "ac170" "ac171" "ac182" "ac185" "ac186" "ac187" "ac188" "ac189" "ac190"
    "ac195" "ac198" "ac222" "ac224" "ac241" "ac242" "ac251" "ac263" "ac265" "ac283"
)

echo "Total files needed: ${#FILES[@]}"
for f in "${FILES[@]}"; do
    echo "  - ${f}.xlsx or ${f}.csv"
done




















































