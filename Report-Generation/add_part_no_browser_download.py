#!/usr/bin/env python3
"""
Add PART_NO using browser to download SharePoint files

This script uses the browser MCP tools to download files from SharePoint,
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

AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
TEMP_DIR = '/tmp/part_no_processing'

def load_ac_mapping():
    """Load AC mappings"""
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

def format_ac_code(ac_code):
    """Format AC code"""
    if ac_code.startswith('WB'):
        num = ac_code[2:].lstrip('0') or '0'
        return num.zfill(3)
    return str(int(ac_code)).zfill(3) if ac_code.isdigit() else ac_code

def load_master_data(file_path):
    """Load master data"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path, engine='openpyxl')
        elif file_path.endswith('.csv'):
            for encoding in ['utf-8', 'latin-1', 'iso-8859-1']:
                try:
                    df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='python', low_memory=False)
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
            col_lower = str(col).lower().strip().replace('_', '').replace(' ', '')
            if not phone_col and any(x in col_lower for x in ['phone', 'mobile', 'contact', 'mobileno']):
                phone_col = col
            if not part_no_col and any(x in col_lower for x in ['partno', 'part_no', 'partnumber', 'partnum']):
                part_no_col = col
        
        if not phone_col or not part_no_col:
            return {}
        
        # Create mapping
        phone_to_part = {}
        for _, row in df.iterrows():
            phone = normalize_phone(row[phone_col])
            if phone and len(phone) >= 10:
                part_no = row[part_no_col]
                if pd.notna(part_no):
                    phone_to_part[phone] = str(part_no).strip()
        
        return phone_to_part
        
    except Exception as e:
        return {}

def process_with_local_files(input_csv, output_csv, master_data_dir):
    """Process using local master data files"""
    print("=" * 70)
    print("ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    print("\n📖 Loading mappings...")
    ac_name_to_code = load_ac_mapping()
    
    print(f"\n📖 Reading CSV...")
    df = pd.read_csv(input_csv)
    print(f"✅ {len(df)} rows")
    
    # Get unique ACs
    unique_ac_names = df['Selected AC'].dropna().unique()
    ac_list = []
    
    for ac_name in unique_ac_names:
        ac_code = ac_name_to_code.get(ac_name)
        if ac_code:
            ac_num = format_ac_code(ac_code)
            ac_list.append({
                'name': ac_name,
                'code': ac_code,
                'num': ac_num,
                'files': [f'ac{ac_num}.xlsx', f'ac{ac_num}.csv']
            })
    
    ac_list.sort(key=lambda x: int(x['num']))
    print(f"✅ {len(ac_list)} unique ACs")
    
    df['PART_NO'] = ''
    
    total_matched = 0
    
    for i, ac in enumerate(ac_list, 1):
        print(f"\n{'='*70}")
        print(f"AC {i}/{len(ac_list)}: {ac['name']} ({ac['code']})")
        
        ac_mask = df['Selected AC'] == ac['name']
        ac_rows = df[ac_mask]
        print(f"  📊 Rows: {len(ac_rows)}")
        
        # Find file locally
        file_path = None
        for file_name in ac['files']:
            local_path = os.path.join(master_data_dir, file_name)
            if os.path.exists(local_path):
                file_path = local_path
                print(f"  ✅ Found: {file_name}")
                break
        
        if not file_path:
            print(f"  ⚠️  File not found locally")
            continue
        
        # Load and process
        phone_to_part = load_master_data(file_path)
        if not phone_to_part:
            print(f"  ⚠️  No mappings created")
            continue
        
        print(f"  ✅ {len(phone_to_part)} mappings")
        
        # Match
        matched = 0
        for idx in ac_rows.index:
            phone = normalize_phone(df.at[idx, 'Respondent Contact Number'])
            if phone and phone in phone_to_part:
                df.at[idx, 'PART_NO'] = phone_to_part[phone]
                matched += 1
        
        print(f"  ✅ Matched {matched}/{len(ac_rows)}")
        total_matched += matched
        
        print(f"\n  📈 Progress: {i}/{len(ac_list)} | Matched: {total_matched}")
    
    # Save
    print(f"\n💾 Saving...")
    df.to_csv(output_csv, index=False)
    
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"✅ Matched: {total_matched}/{len(df)} ({(total_matched/len(df)*100):.2f}%)")
    print(f"💾 Output: {output_csv}")
    print(f"{'='*70}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 add_part_no_browser_download.py <input_csv> <output_csv> [master_data_dir]")
        sys.exit(1)
    
    master_data_dir = sys.argv[3] if len(sys.argv) > 3 else '/var/www/Report-Generation/master_data'
    process_with_local_files(sys.argv[1], sys.argv[2], master_data_dir)




















































