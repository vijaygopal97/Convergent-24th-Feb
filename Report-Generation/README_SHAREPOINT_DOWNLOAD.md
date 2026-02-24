# SharePoint Download Solution

## Current Situation
SharePoint files require `sourcedoc` GUIDs for download. The URL format is:
```
https://cvrcpl-my.sharepoint.com/:x:/r/personal/milan_convergentview_com/_layouts/15/Doc.aspx?sourcedoc={GUID}&file=filename&action=download
```

## Solution Options

### Option 1: Manual Download (Recommended - Fastest)
1. Open SharePoint: https://cvrcpl-my.sharepoint.com/:f:/g/personal/milan_convergentview_com/IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0?e=U6w7b6
2. Download the 46 AC files needed (based on CSV analysis)
3. Save to: `/var/www/Report-Generation/master_data/`
4. Run: `python3 /var/www/Report-Generation/add_part_no_browser_download.py input.csv output.csv`

### Option 2: Browser Automation
Use browser tools to download files one by one (slower but automatic)

### Option 3: Get File GUIDs
Extract file GUIDs from SharePoint page and construct download URLs

## Files Needed
Based on the CSV, you need these AC files:
- ac001.xlsx or ac001.csv (Mekliganj)
- ac004.xlsx or ac004.csv (COOCHBEHAR DAKSHIN)
- ... (46 total files)

## Processing Script
Once files are available, run:
```bash
python3 /var/www/Report-Generation/add_part_no_browser_download.py \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144.csv \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144_with_partno.csv \
  /var/www/Report-Generation/master_data
```

The script will:
- Process one AC at a time
- Match phone numbers to PART_NO
- Save space by processing and moving on
