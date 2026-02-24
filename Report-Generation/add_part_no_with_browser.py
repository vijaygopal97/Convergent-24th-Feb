#!/usr/bin/env python3
"""
Add PART_NO using browser automation to download SharePoint files

This script uses selenium/playwright to download files from SharePoint,
then processes them efficiently.
"""

import pandas as pd
import sys
import os
import json
import re
import subprocess
import tempfile
import time

# Check if selenium is available, if not, provide instructions
try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False
    print("⚠️  Selenium not available. Please install: pip install selenium")

AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
TEMP_DIR = '/tmp/part_no_processing'
SHAREPOINT_URL = 'https://cvrcpl-my.sharepoint.com/:f:/g/personal/milan_convergentview_com/IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0?e=U6w7b6'

def load_ac_mapping():
    """Load AC code to AC name mapping"""
    with open(AC_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    wb_acs = data['states']['West Bengal']['assemblyConstituencies']
    ac_name_to_code = {ac['acName']: ac['acCode'] for ac in wb_acs}
    return ac_name_to_code

def normalize_phone(phone):
    """Normalize phone number"""
    if pd.isna(phone):
        return None
    return re.sub(r'\D', '', str(phone).strip())

def format_ac_code_for_file(ac_code):
    """Format AC code for filename"""
    if ac_code.startswith('WB'):
        return ac_code[2:].lstrip('0').zfill(3) or '000'
    return str(int(ac_code)).zfill(3) if ac_code.isdigit() else ac_code

def download_with_requests_enhanced(file_name, temp_dir):
    """Enhanced download with better SharePoint URL handling"""
    file_path = os.path.join(temp_dir, file_name)
    
    # Try using wget or curl which might handle SharePoint better
    share_id = 'IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0'
    
    # Try wget first (often handles SharePoint better)
    url = f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/download.aspx?share={share_id}&file={file_name}'
    
    try:
        # Use wget with proper headers
        cmd = [
            'wget',
            '--no-check-certificate',
            '--header=User-Agent: Mozilla/5.0',
            '--header=Accept: */*',
            '-O', file_path,
            url
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        
        if result.returncode == 0 and os.path.exists(file_path) and os.path.getsize(file_path) > 1000:
            # Check if it's a valid file
            with open(file_path, 'rb') as f:
                first_bytes = f.read(4)
                if first_bytes.startswith(b'PK') or file_path.endswith('.csv'):
                    print(f"    ✅ Downloaded via wget: {file_name} ({os.path.getsize(file_path) / 1024 / 1024:.2f} MB)")
                    return file_path
        
        # If wget failed, try curl
        if os.path.exists(file_path):
            os.remove(file_path)
            
        cmd = [
            'curl',
            '-L',
            '--user-agent', 'Mozilla/5.0',
            '-o', file_path,
            url
        ]
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        
        if result.returncode == 0 and os.path.exists(file_path) and os.path.getsize(file_path) > 1000:
            with open(file_path, 'rb') as f:
                first_bytes = f.read(4)
                if first_bytes.startswith(b'PK') or file_path.endswith('.csv'):
                    print(f"    ✅ Downloaded via curl: {file_name} ({os.path.getsize(file_path) / 1024 / 1024:.2f} MB)")
                    return file_path
        
    except Exception as e:
        print(f"    ⚠️  wget/curl error: {str(e)[:100]}")
    
    return None

def load_master_data(file_path):
    """Load master data and create phone to PART_NO mapping"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path, engine='openpyxl')
        elif file_path.endswith('.csv'):
            # Try multiple encodings and delimiters
            for encoding in ['utf-8', 'latin-1', 'iso-8859-1']:
                try:
                    df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='python')
                    break
                except:
                    continue
            else:
                return {}
        else:
            return {}
        
        # Find columns
        phone_col = None
        part_no_col = None
        
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if not phone_col and any(x in col_lower for x in ['phone', 'mobile', 'contact', 'mobileno']):
                phone_col = col
            if not part_no_col and any(x in col_lower for x in ['part_no', 'part no', 'part_number', 'partno', 'part']):
                part_no_col = col
        
        if not phone_col or not part_no_col:
            print(f"      ⚠️  Columns not found. Phone: {phone_col}, PART_NO: {part_no_col}")
            print(f"      Available: {list(df.columns)[:15]}")
            return {}
        
        # Create mapping
        phone_to_part = {}
        for _, row in df.iterrows():
            phone = normalize_phone(row[phone_col])
            if phone:
                part_no = row[part_no_col]
                if pd.notna(part_no):
                    phone_to_part[phone] = str(part_no).strip()
        
        print(f"      ✅ Created {len(phone_to_part)} mappings")
        return phone_to_part
        
    except Exception as e:
        print(f"      ❌ Error: {str(e)[:150]}")
        return {}

def process_csv_efficiently(input_csv, output_csv):
    """Process CSV efficiently"""
    print("=" * 70)
    print("ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    print("\n📖 Loading AC mappings...")
    ac_name_to_code = load_ac_mapping()
    
    print(f"\n📖 Reading CSV...")
    df = pd.read_csv(input_csv)
    print(f"✅ Read {len(df)} rows")
    
    # Get unique ACs
    unique_ac_names = df['Selected AC'].dropna().unique()
    ac_list = []
    
    for ac_name in unique_ac_names:
        ac_code = ac_name_to_code.get(ac_name)
        if ac_code:
            ac_num = format_ac_code_for_file(ac_code)
            ac_list.append({
                'name': ac_name,
                'code': ac_code,
                'num': ac_num,
                'files': [f'ac{ac_num}.xlsx', f'ac{ac_num}.csv']
            })
    
    ac_list.sort(key=lambda x: int(x['num']))
    print(f"✅ Found {len(ac_list)} unique ACs")
    
    df['PART_NO'] = ''
    
    total_matched = 0
    total_not_matched = 0
    
    for i, ac in enumerate(ac_list, 1):
        print(f"\n{'='*70}")
        print(f"AC {i}/{len(ac_list)}: {ac['name']} ({ac['code']})")
        print(f"{'='*70}")
        
        ac_mask = df['Selected AC'] == ac['name']
        ac_rows = df[ac_mask]
        print(f"  📊 Rows: {len(ac_rows)}")
        
        # Try to download file
        file_path = None
        for file_name in ac['files']:
            print(f"  📥 Downloading {file_name}...")
            file_path = download_with_requests_enhanced(file_name, TEMP_DIR)
            if file_path:
                break
        
        if not file_path:
            print(f"  ❌ Could not download file")
            total_not_matched += len(ac_rows)
            continue
        
        # Load and process
        print(f"  📖 Loading master data...")
        phone_to_part = load_master_data(file_path)
        
        if not phone_to_part:
            print(f"  ⚠️  No mappings created")
            total_not_matched += len(ac_rows)
            try:
                os.remove(file_path)
            except:
                pass
            continue
        
        # Match phones
        print(f"  🔍 Matching...")
        matched = 0
        for idx in ac_rows.index:
            phone = normalize_phone(df.at[idx, 'Respondent Contact Number'])
            if phone and phone in phone_to_part:
                df.at[idx, 'PART_NO'] = phone_to_part[phone]
                matched += 1
        
        print(f"  ✅ Matched {matched}/{len(ac_rows)}")
        total_matched += matched
        total_not_matched += (len(ac_rows) - matched)
        
        # Delete file
        try:
            os.remove(file_path)
            print(f"  🗑️  Deleted to save space")
        except:
            pass
        
        print(f"\n  📈 Progress: {i}/{len(ac_list)} | Matched: {total_matched} | Not matched: {total_not_matched}")
    
    # Save output
    print(f"\n{'='*70}")
    print(f"💾 Saving output...")
    df.to_csv(output_csv, index=False)
    
    try:
        import shutil
        shutil.rmtree(TEMP_DIR)
    except:
        pass
    
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"{'='*70}")
    print(f"Total: {len(df)}")
    print(f"✅ Matched: {total_matched}")
    print(f"❌ Not matched: {total_not_matched}")
    print(f"📊 Rate: {(total_matched/len(df)*100):.2f}%")
    print(f"💾 Saved: {output_csv}")
    print(f"{'='*70}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 add_part_no_with_browser.py <input_csv> <output_csv>")
        sys.exit(1)
    
    process_csv_efficiently(sys.argv[1], sys.argv[2])




















































