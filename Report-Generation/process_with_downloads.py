#!/usr/bin/env python3
"""
Process CSV and add PART_NO, monitoring download directory for new files
"""

import pandas as pd
import sys
import os
import json
import re
import time
from pathlib import Path

AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
DOWNLOAD_DIR = '/var/www/Report-Generation/master_data'
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
        
        if len(df) == 0:
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

def process_csv(input_csv, output_csv):
    """Process CSV and add PART_NO"""
    print("=" * 70)
    print("ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
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
    total_not_matched = 0
    
    for i, ac in enumerate(ac_list, 1):
        print(f"\n{'='*70}")
        print(f"AC {i}/{len(ac_list)}: {ac['name']} ({ac['code']})")
        
        ac_mask = df['Selected AC'] == ac['name']
        ac_rows = df[ac_mask]
        print(f"  📊 Rows: {len(ac_rows)}")
        
        # Find file
        file_path = None
        for file_name in ac['files']:
            local_path = os.path.join(DOWNLOAD_DIR, file_name)
            if os.path.exists(local_path):
                file_path = local_path
                print(f"  ✅ Found: {file_name}")
                break
        
        if not file_path:
            print(f"  ⚠️  File not found - please download {ac['files'][0]} or {ac['files'][1]}")
            total_not_matched += len(ac_rows)
            continue
        
        # Load and process
        phone_to_part = load_master_data(file_path)
        if not phone_to_part:
            print(f"  ⚠️  No mappings created from file")
            total_not_matched += len(ac_rows)
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
        total_not_matched += (len(ac_rows) - matched)
        
        print(f"\n  📈 Overall: {i}/{len(ac_list)} | ✅ {total_matched} | ❌ {total_not_matched}")
    
    # Save
    print(f"\n{'='*70}")
    print(f"💾 Saving...")
    df.to_csv(output_csv, index=False)
    
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"✅ Matched: {total_matched}/{len(df)} ({(total_matched/len(df)*100):.2f}%)")
    print(f"💾 Output: {output_csv}")
    print(f"{'='*70}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 process_with_downloads.py <input_csv> <output_csv>")
        sys.exit(1)
    
    process_csv(sys.argv[1], sys.argv[2])




















































