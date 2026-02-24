#!/usr/bin/env python3
"""
Add PART_NO using SharePoint file GUIDs

This script uses the browser to get file GUIDs from SharePoint,
then constructs proper download URLs.
"""

import pandas as pd
import sys
import os
import json
import re
import requests
import tempfile
import time
from urllib.parse import quote

AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
TEMP_DIR = '/tmp/part_no_processing'
SHAREPOINT_BASE = 'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com'

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

def download_with_guid(file_name, file_guid, temp_dir):
    """Download file using sourcedoc GUID"""
    file_path = os.path.join(temp_dir, file_name)
    
    # URL format from user: 
    # https://cvrcpl-my.sharepoint.com/:x:/r/personal/milan_convergentview_com/_layouts/15/Doc.aspx?sourcedoc=%7BFFF5217E-A6E6-4F02-B65A-BF5DDEAA3F2C%7D&file=ac1.csv&action=download
    
    # Construct download URL with GUID
    guid_encoded = quote(f'{{{file_guid}}}', safe='')
    download_url = f'{SHAREPOINT_BASE}/_layouts/15/Doc.aspx?sourcedoc={guid_encoded}&file={quote(file_name)}&action=download'
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://cvrcpl-my.sharepoint.com/'
    }
    
    try:
        response = requests.get(download_url, headers=headers, stream=True, timeout=30, allow_redirects=True)
        
        if response.status_code == 200:
            file_size = 0
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        file_size += len(chunk)
            
            # Validate
            if file_size > 1000:
                with open(file_path, 'rb') as f:
                    first_bytes = f.read(10)
                    if first_bytes.startswith(b'PK') or (file_name.endswith('.csv') and b'<' not in first_bytes):
                        print(f"    ✅ Downloaded ({file_size/1024/1024:.2f} MB)")
                        return file_path
            
            if os.path.exists(file_path):
                os.remove(file_path)
        
        return None
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        return None

def get_file_guid_from_browser(file_name):
    """Use browser to get file GUID - placeholder for browser automation"""
    # This would use browser MCP tools to navigate and get GUID
    # For now, return None - will need to implement browser automation
    return None

def download_sharepoint_file(file_name, temp_dir):
    """Download file - try multiple methods"""
    file_path = os.path.join(temp_dir, file_name)
    
    # Method 1: Try to get GUID from browser (if implemented)
    guid = get_file_guid_from_browser(file_name)
    if guid:
        result = download_with_guid(file_name, guid, temp_dir)
        if result:
            return result
    
    # Method 2: Try direct download using server-relative path
    # Sometimes SharePoint allows this for shared files
    server_path = f"/personal/milan_convergentview_com/Documents/Desktop/MISC/Political Insights-2023-2024/West Bengal/WB CATI Database/{file_name}"
    
    url_patterns = [
        # Try download.aspx with SourceUrl
        f'{SHAREPOINT_BASE}/_layouts/15/download.aspx?SourceUrl={quote(server_path)}',
        # Try using share ID
        f'{SHAREPOINT_BASE}/_layouts/15/download.aspx?share=IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0&file={quote(file_name)}',
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': 'https://cvrcpl-my.sharepoint.com/'
    }
    
    for i, url in enumerate(url_patterns, 1):
        try:
            print(f"    Pattern {i}...", end=' ')
            response = requests.get(url, headers=headers, stream=True, timeout=30, allow_redirects=True)
            
            if response.status_code == 200:
                file_size = 0
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            file_size += len(chunk)
                
                if file_size > 1000:
                    with open(file_path, 'rb') as f:
                        first_bytes = f.read(10)
                        if first_bytes.startswith(b'PK') or (file_name.endswith('.csv') and b'<' not in first_bytes and not first_bytes.startswith(b'<!')):
                            print(f"✅ ({file_size/1024/1024:.2f} MB)")
                            return file_path
                
                if os.path.exists(file_path):
                    os.remove(file_path)
                print("Invalid")
            else:
                print(f"HTTP {response.status_code}")
        except Exception as e:
            print(f"Error")
            if os.path.exists(file_path):
                os.remove(file_path)
            continue
    
    return None

def load_master_data(file_path):
    """Load master data"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path, engine='openpyxl')
        elif file_path.endswith('.csv'):
            for encoding in ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']:
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
            if not phone_col and any(x in col_lower for x in ['phone', 'mobile', 'contact', 'mobileno', 'tel']):
                phone_col = col
            if not part_no_col and any(x in col_lower for x in ['partno', 'part_no', 'partnumber', 'partnum', 'part']):
                part_no_col = col
        
        if not phone_col or not part_no_col:
            print(f"      ⚠️  Columns: Phone={phone_col}, PART_NO={part_no_col}")
            print(f"      Available: {list(df.columns)[:20]}")
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
        print(f"      ❌ Error: {str(e)[:150]}")
        return {}

def process_csv_efficiently(input_csv, output_csv):
    """Process CSV efficiently"""
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
                'files': [f'ac{ac_num}.xlsx', f'ac{ac_num}.csv', f'AC{ac_num}.xlsx', f'AC{ac_num}.csv']
            })
    
    ac_list.sort(key=lambda x: int(x['num']))
    print(f"✅ {len(ac_list)} unique ACs")
    
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
        
        # Download file
        file_path = None
        for file_name in ac['files']:
            print(f"  📥 {file_name}...", end=' ')
            file_path = download_sharepoint_file(file_name, TEMP_DIR)
            if file_path:
                break
        
        if not file_path:
            print(f"\n  ❌ File not found")
            total_not_matched += len(ac_rows)
            continue
        
        # Load and process
        print(f"\n  📖 Loading...", end=' ')
        phone_to_part = load_master_data(file_path)
        
        if not phone_to_part:
            print(f"Failed")
            total_not_matched += len(ac_rows)
            try:
                os.remove(file_path)
            except:
                pass
            continue
        
        print(f"✅ {len(phone_to_part)} mappings")
        
        # Match
        print(f"  🔍 Matching...", end=' ')
        matched = 0
        for idx in ac_rows.index:
            phone = normalize_phone(df.at[idx, 'Respondent Contact Number'])
            if phone and phone in phone_to_part:
                df.at[idx, 'PART_NO'] = phone_to_part[phone]
                matched += 1
        
        print(f"✅ {matched}/{len(ac_rows)}")
        total_matched += matched
        total_not_matched += (len(ac_rows) - matched)
        
        # Delete file
        try:
            os.remove(file_path)
        except:
            pass
        
        print(f"\n  📈 Overall: {i}/{len(ac_list)} | ✅ {total_matched} | ❌ {total_not_matched}")
    
    # Save
    print(f"\n{'='*70}")
    print(f"💾 Saving...")
    df.to_csv(output_csv, index=False)
    
    try:
        import shutil
        shutil.rmtree(TEMP_DIR)
    except:
        pass
    
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"✅ Matched: {total_matched}/{len(df)} ({(total_matched/len(df)*100):.2f}%)")
    print(f"💾 Output: {output_csv}")
    print(f"{'='*70}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 add_part_no_with_guids.py <input_csv> <output_csv>")
        sys.exit(1)
    
    try:
        process_csv_efficiently(sys.argv[1], sys.argv[2])
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)




















































