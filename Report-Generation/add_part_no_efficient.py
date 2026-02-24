#!/usr/bin/env python3
"""
Efficiently Add PART_NO column to CATI responses report

This script:
1. Identifies which ACs are needed from the CSV
2. Downloads only the required AC files from SharePoint one at a time
3. Processes all rows for that AC
4. Deletes the file to save space
5. Moves to next AC

This approach saves disk space by not downloading all files at once.
"""

import pandas as pd
import sys
import os
import json
import re
import requests
from pathlib import Path
import tempfile
from urllib.parse import urlparse, parse_qs
import time

# Constants
AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
SHAREPOINT_BASE_URL = 'https://cvrcpl-my.sharepoint.com/:f:/g/personal/milan_convergentview_com/IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0?e=U6w7b6'
TEMP_DIR = '/tmp/part_no_processing'

def load_ac_mapping():
    """Load AC code to AC name mapping from JSON"""
    with open(AC_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    wb_acs = data['states']['West Bengal']['assemblyConstituencies']
    
    ac_code_to_name = {}
    ac_name_to_code = {}
    
    for ac in wb_acs:
        ac_code = ac['acCode']
        ac_name = ac['acName']
        ac_code_to_name[ac_code] = ac_name
        ac_name_to_code[ac_name] = ac_code
    
    return ac_code_to_name, ac_name_to_code

def normalize_phone(phone):
    """Normalize phone number for matching"""
    if pd.isna(phone):
        return None
    phone_str = str(phone).strip()
    phone_clean = re.sub(r'\D', '', phone_str)
    return phone_clean

def format_ac_code_for_file(ac_code):
    """Format AC code for filename (WB001 -> 001, WB251 -> 251)"""
    if ac_code.startswith('WB'):
        return ac_code[2:].lstrip('0') or '0'
    return str(int(ac_code)) if ac_code.isdigit() else ac_code

def download_file_from_sharepoint(file_name, temp_dir):
    """Download a file from SharePoint"""
    # SharePoint direct download URL format
    # We need to construct the download URL
    # Format: https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/download.aspx?share=...
    
    # Try different URL patterns
    base_urls = [
        f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/download.aspx',
    ]
    
    # For now, we'll use a simpler approach - try to get the file directly
    # SharePoint files can be accessed via direct links if we have the right format
    
    file_path = os.path.join(temp_dir, file_name)
    
    # Try to download using requests with the SharePoint folder structure
    # Note: This might need adjustment based on actual SharePoint structure
    download_url = f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/Documents/Desktop/MISC/Political%20Insights-2023-2024/West%20Bengal/WB%20CATI%20Database/{file_name}'
    
    try:
        print(f"    Attempting to download: {file_name}")
        response = requests.get(download_url, stream=True, timeout=30)
        
        if response.status_code == 200:
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print(f"    ✅ Downloaded: {file_name} ({os.path.getsize(file_path) / 1024 / 1024:.2f} MB)")
            return file_path
        else:
            print(f"    ⚠️  HTTP {response.status_code} for {file_name}")
            return None
    except Exception as e:
        print(f"    ❌ Error downloading {file_name}: {str(e)}")
        return None

def load_master_data_for_ac(file_path):
    """Load master data file and create phone to PART_NO mapping"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        # Try to read as Excel first
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path)
        elif file_path.endswith('.csv'):
            df = pd.read_csv(file_path)
        else:
            return {}
        
        # Find phone and PART_NO columns
        phone_col = None
        part_no_col = None
        
        phone_cols = ['phone', 'Phone', 'PHONE', 'MOBILE_NO', 'mobile_no', 'Mobile No', 
                     'Contact Number', 'contact_number', 'Contact', 'contact', 'Mobile']
        part_no_cols = ['PART_NO', 'part_no', 'Part No', 'PART NO', 'Part_No', 
                       'part number', 'Part Number', 'PART_NUMBER', 'Part Number']
        
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if not phone_col and any(pc.lower() in col_lower for pc in phone_cols):
                phone_col = col
            if not part_no_col and any(pnc.lower() in col_lower for pnc in part_no_cols):
                part_no_col = col
        
        if not phone_col or not part_no_col:
            print(f"      ⚠️  Required columns not found. Phone: {phone_col}, PART_NO: {part_no_col}")
            print(f"      Available columns: {list(df.columns)[:10]}")
            return {}
        
        # Create phone to PART_NO mapping
        phone_to_part = {}
        for idx, row in df.iterrows():
            phone = normalize_phone(row[phone_col])
            if phone and phone not in phone_to_part:
                part_no = row[part_no_col]
                if pd.notna(part_no):
                    phone_to_part[phone] = str(part_no).strip()
        
        return phone_to_part
        
    except Exception as e:
        print(f"      ❌ Error loading {file_path}: {str(e)}")
        return {}

def process_csv_efficiently(input_csv, output_csv):
    """Process CSV efficiently by downloading AC files one at a time"""
    print("=" * 70)
    print("EFFICIENTLY ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    print(f"Input CSV: {input_csv}")
    print(f"Output CSV: {output_csv}")
    print("=" * 70)
    
    # Create temp directory
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    # Load AC mappings
    print("\n📖 Loading AC mappings...")
    ac_code_to_name, ac_name_to_code = load_ac_mapping()
    print(f"✅ Loaded {len(ac_name_to_code)} AC mappings")
    
    # Read input CSV to identify needed ACs
    print(f"\n📖 Analyzing input CSV: {input_csv}")
    df_full = pd.read_csv(input_csv)
    print(f"✅ Read {len(df_full)} rows")
    
    # Get unique ACs and their codes
    unique_ac_names = df_full['Selected AC'].dropna().unique()
    ac_info = []
    
    for ac_name in unique_ac_names:
        ac_code = ac_name_to_code.get(ac_name)
        if ac_code:
            ac_num = format_ac_code_for_file(ac_code)
            ac_info.append({
                'name': ac_name,
                'code': ac_code,
                'file_num': ac_num,
                'file_patterns': [
                    f'ac{ac_num.zfill(3)}.xlsx',
                    f'ac{ac_num.zfill(3)}.csv',
                    f'AC{ac_num.zfill(3)}.xlsx',
                    f'AC{ac_num.zfill(3)}.csv',
                    f'ac{int(ac_num)}.xlsx' if ac_num.isdigit() else None,
                ]
            })
    
    ac_info.sort(key=lambda x: int(x['file_num']) if x['file_num'].isdigit() else 999)
    print(f"✅ Identified {len(ac_info)} unique ACs to process")
    
    # Initialize PART_NO column
    df_full['PART_NO'] = ''
    
    # Process each AC
    total_matched = 0
    total_not_matched = 0
    
    for ac_idx, ac in enumerate(ac_info, 1):
        print(f"\n{'='*70}")
        print(f"Processing AC {ac_idx}/{len(ac_info)}: {ac['name']} ({ac['code']})")
        print(f"{'='*70}")
        
        # Count rows for this AC
        ac_rows = df_full[df_full['Selected AC'] == ac['name']]
        print(f"  📊 Rows for this AC: {len(ac_rows)}")
        
        # Try to download the file
        file_path = None
        for pattern in ac['file_patterns']:
            if not pattern:
                continue
            file_path = download_file_from_sharepoint(pattern, TEMP_DIR)
            if file_path and os.path.exists(file_path):
                break
        
        if not file_path or not os.path.exists(file_path):
            print(f"  ⚠️  Could not download master data file for {ac['name']}")
            total_not_matched += len(ac_rows)
            continue
        
        # Load master data
        print(f"  📖 Loading master data...")
        phone_to_part = load_master_data_for_ac(file_path)
        print(f"  ✅ Loaded {len(phone_to_part)} phone-to-PART_NO mappings")
        
        # Match phone numbers
        print(f"  🔍 Matching phone numbers...")
        matched = 0
        for idx in ac_rows.index:
            phone = normalize_phone(df_full.at[idx, 'Respondent Contact Number'])
            if phone and phone in phone_to_part:
                df_full.at[idx, 'PART_NO'] = phone_to_part[phone]
                matched += 1
        
        print(f"  ✅ Matched {matched}/{len(ac_rows)} rows for this AC")
        total_matched += matched
        total_not_matched += (len(ac_rows) - matched)
        
        # Delete file to save space
        try:
            os.remove(file_path)
            print(f"  🗑️  Deleted {os.path.basename(file_path)} to save space")
        except:
            pass
        
        # Progress update
        print(f"\n  📈 Overall Progress: {ac_idx}/{len(ac_info)} ACs processed")
        print(f"     Total matched: {total_matched}, Not matched: {total_not_matched}")
    
    # Save output
    print(f"\n{'='*70}")
    print(f"💾 Saving output CSV: {output_csv}")
    df_full.to_csv(output_csv, index=False)
    
    # Cleanup temp directory
    try:
        import shutil
        shutil.rmtree(TEMP_DIR)
    except:
        pass
    
    # Print final summary
    print(f"\n{'='*70}")
    print("PROCESSING COMPLETE")
    print(f"{'='*70}")
    print(f"Total rows processed: {len(df_full)}")
    print(f"✅ Matched with PART_NO: {total_matched}")
    print(f"❌ Not matched: {total_not_matched}")
    print(f"📊 Match rate: {(total_matched / len(df_full) * 100):.2f}%")
    print(f"💾 Output saved to: {output_csv}")
    print(f"{'='*70}")

def main():
    if len(sys.argv) < 3:
        print("Error: Insufficient arguments")
        print("\nUsage:")
        print("  python3 add_part_no_efficient.py <input_csv> <output_csv>")
        print("\nExample:")
        print("  python3 add_part_no_efficient.py input.csv output.csv")
        sys.exit(1)
    
    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    
    if not os.path.exists(input_csv):
        print(f"Error: Input CSV file not found: {input_csv}")
        sys.exit(1)
    
    try:
        process_csv_efficiently(input_csv, output_csv)
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()




















































