#!/usr/bin/env python3
"""
Script to download SharePoint files using browser automation
This will be called to download files one by one
"""

import json
import sys

# Read the files needed
with open('/tmp/ac_files_needed.json', 'r') as f:
    files_needed = json.load(f)

# Get unique file names (prefer .xlsx, fallback to .csv)
files_to_download = []
for ac_name, info in files_needed.items():
    # Try xlsx first, then csv
    if 'ac' + info['num'] + '.xlsx' in info['files']:
        files_to_download.append('ac' + info['num'] + '.xlsx')
    elif 'ac' + info['num'] + '.csv' in info['files']:
        files_to_download.append('ac' + info['num'] + '.csv')

print(f"Files to download: {len(files_to_download)}")
for f in files_to_download[:10]:
    print(f"  - {f}")




















































