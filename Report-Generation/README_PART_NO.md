# Adding PART_NO to CATI Responses Report

## Overview
This script adds a PART_NO column to the CATI responses report by matching phone numbers with master data files.

## Requirements
1. Master data files from SharePoint must be downloaded to `/var/www/Report-Generation/master_data/`
2. Files should be named as: ac001.xlsx, ac002.xlsx, etc. (or ac001.csv, etc.)
3. Each file should contain:
   - Phone number column
   - PART_NO column

## Usage
```bash
python3 /var/www/Report-Generation/add_part_no_to_cati_report.py \
  <input_csv> \
  <output_csv> \
  [master_data_dir]
```

## Example
```bash
python3 /var/www/Report-Generation/add_part_no_to_cati_report.py \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144.csv \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144_with_partno.csv
```

## Features
- Processes CSV in chunks (1000 rows at a time) to save memory
- Caches master data per AC to avoid reloading
- Handles various phone number formats
- Supports both Excel (.xlsx) and CSV master data files
- Efficient phone number normalization and matching
