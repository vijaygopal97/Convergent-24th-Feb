# Instructions for Downloading Master Data Files from SharePoint

## SharePoint Location
https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fmilan%5Fconvergentview%5Fcom%2FDocuments%2FDesktop%2FMISC%2FPolitical%20Insights%2D2023%2D2024%2FWest%20Bengal%2FWB%20CATI%20Database&ga=1

## Steps:
1. Navigate to the SharePoint URL above
2. Download all AC master data files (likely named as ac001.xlsx, ac002.xlsx, etc. or similar format)
3. Save them to: `/var/www/Report-Generation/master_data/`

## Expected File Format:
- Files should contain columns for:
  - Phone number (variations: phone, Phone, MOBILE_NO, mobile_no, Contact Number, etc.)
  - PART_NO (variations: PART_NO, part_no, Part No, PART NO, etc.)

## After Downloading:
Run the script:
```bash
python3 /var/www/Report-Generation/add_part_no_to_cati_report.py \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144.csv \
  /var/www/reports/cati_responses_report_ALL_TIME_2026-02-02_073144_with_partno.csv
```




















































