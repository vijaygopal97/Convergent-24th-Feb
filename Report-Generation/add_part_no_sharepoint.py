#!/usr/bin/env python3
"""
Efficiently Add PART_NO column using SharePoint files

Downloads AC files one at a time, processes, then deletes to save space.
Uses SharePoint direct download URLs.
"""

import pandas as pd
import sys
import os
import json
import re
import requests
from pathlib import Path
import tempfile
import time

# Constants
AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
TEMP_DIR = '/tmp/part_no_processing'
CHUNK_SIZE = 8192

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
    """Format AC code for filename"""
    if ac_code.startswith('WB'):
        num = ac_code[2:].lstrip('0') or '0'
        return num.zfill(3)
    return str(int(ac_code)).zfill(3) if ac_code.isdigit() else ac_code

def download_sharepoint_file(file_name, temp_dir):
    """Download file from SharePoint using REST API or direct download"""
    file_path = os.path.join(temp_dir, file_name)
    
    from urllib.parse import quote, unquote
    encoded_file = quote(file_name)
    
    # SharePoint REST API endpoint to get file download URL
    # First, try to get file info using REST API
    folder_path = "/personal/milan_convergentview_com/Documents/Desktop/MISC/Political Insights-2023-2024/West Bengal/WB CATI Database"
    rest_url = f"https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_api/web/GetFolderByServerRelativeUrl('{quote(folder_path)}')/Files('{encoded_file}')/$value"
    
    # Try different URL patterns
    url_patterns = [
        # Pattern 1: REST API direct download
        rest_url,
        # Pattern 2: Using download.aspx with share ID and file
        f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/download.aspx?share=IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0&file={encoded_file}',
        # Pattern 3: Direct path
        f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/Documents/Desktop/MISC/Political%20Insights-2023-2024/West%20Bengal/WB%20CATI%20Database/{encoded_file}',
        # Pattern 4: Using webUrl with file parameter
        f'https://cvrcpl-my.sharepoint.com/personal/milan_convergentview_com/_layouts/15/download.aspx?share=IgDPeHah8fIMRqMoSZnmgzKVAfQ1u6e_oljAiUznsKEVvi0&file={file_name}',
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
    }
    
    session = requests.Session()
    session.headers.update(headers)
    
    for i, url in enumerate(url_patterns, 1):
        try:
            print(f"    Trying pattern {i}...")
            response = session.get(url, stream=True, timeout=60, allow_redirects=True)
            
            # Check if it's actually a file (not HTML error page)
            content_type = response.headers.get('Content-Type', '').lower()
            content_length = response.headers.get('Content-Length', '0')
            
            if response.status_code == 200:
                file_size = 0
                with open(file_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                        if chunk:
                            f.write(chunk)
                            file_size += len(chunk)
                
                # Check if file is valid (not HTML error page)
                if file_size > 1000:  # Excel files should be > 1KB
                    # Quick check: Excel files start with PK (ZIP signature)
                    with open(file_path, 'rb') as f:
                        first_bytes = f.read(4)
                        if first_bytes.startswith(b'PK') or file_path.endswith('.csv'):
                            print(f"    ✅ Downloaded: {file_name} ({file_size / 1024 / 1024:.2f} MB)")
                            return file_path
                        else:
                            # Might be HTML, check
                            f.seek(0)
                            content = f.read(500).decode('utf-8', errors='ignore')
                            if '<html' in content.lower() or '<!doctype' in content.lower():
                                print(f"    ⚠️  Got HTML page instead of file")
                                os.remove(file_path)
                                continue
                            # Might still be valid, return it
                            print(f"    ✅ Downloaded: {file_name} ({file_size / 1024 / 1024:.2f} MB)")
                            return file_path
                else:
                    os.remove(file_path)
                    print(f"    ⚠️  File too small ({file_size} bytes), likely error page")
            else:
                print(f"    ⚠️  HTTP {response.status_code}")
        except Exception as e:
            print(f"    ⚠️  Error: {str(e)[:100]}")
            if os.path.exists(file_path):
                os.remove(file_path)
            continue
    
    return None

def load_master_data(file_path):
    """Load master data and create phone to PART_NO mapping"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        # Read file
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path, engine='openpyxl')
        elif file_path.endswith('.csv'):
            # Try different delimiters and encodings
            try:
                df = pd.read_csv(file_path, encoding='utf-8')
            except:
                try:
                    df = pd.read_csv(file_path, encoding='latin-1')
                except:
                    try:
                        df = pd.read_csv(file_path, sep='\t', encoding='utf-8')
                    except:
                        try:
                            df = pd.read_csv(file_path, sep=';', encoding='utf-8')
                        except:
                            # Try to auto-detect delimiter
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                first_line = f.readline()
                                if '\t' in first_line:
                                    df = pd.read_csv(file_path, sep='\t', encoding='utf-8')
                                elif ';' in first_line:
                                    df = pd.read_csv(file_path, sep=';', encoding='utf-8')
                                else:
                                    df = pd.read_csv(file_path, encoding='utf-8', on_bad_lines='skip', engine='python')
        else:
            return {}
        
        # Debug: print first few rows and columns
        print(f"      📋 File shape: {df.shape}, Columns: {list(df.columns)[:10]}")
        if len(df) > 0:
            print(f"      📋 First row sample: {dict(list(df.iloc[0].items())[:5])}")
        
        # Find columns
        phone_col = None
        part_no_col = None
        
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if not phone_col and any(x in col_lower for x in ['phone', 'mobile', 'contact']):
                phone_col = col
            if not part_no_col and any(x in col_lower for x in ['part_no', 'part no', 'part_number', 'partno']):
                part_no_col = col
        
        if not phone_col or not part_no_col:
            print(f"      ⚠️  Columns not found. Phone: {phone_col}, PART_NO: {part_no_col}")
            print(f"      Available columns: {list(df.columns)}")
            # Try to save a sample for inspection
            sample_path = file_path.replace('.csv', '_sample.csv').replace('.xlsx', '_sample.csv')
            try:
                df.head(5).to_csv(sample_path, index=False)
                print(f"      💾 Saved sample to: {sample_path}")
            except:
                pass
            return {}
        
        # Create mapping
        phone_to_part = {}
        for _, row in df.iterrows():
            phone = normalize_phone(row[phone_col])
            if phone:
                part_no = row[part_no_col]
                if pd.notna(part_no):
                    phone_to_part[phone] = str(part_no).strip()
        
        return phone_to_part
        
    except Exception as e:
        print(f"      ❌ Error: {str(e)}")
        return {}

def process_csv_efficiently(input_csv, output_csv):
    """Process CSV by downloading AC files one at a time"""
    print("=" * 70)
    print("EFFICIENTLY ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    print(f"Input: {input_csv}")
    print(f"Output: {output_csv}")
    print("=" * 70)
    
    # Setup
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    # Load mappings
    print("\n📖 Loading AC mappings...")
    _, ac_name_to_code = load_ac_mapping()
    print(f"✅ Loaded mappings")
    
    # Read CSV
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
                'file_name': f'ac{ac_num}.xlsx'
            })
    
    ac_list.sort(key=lambda x: int(x['num']))
    print(f"✅ Found {len(ac_list)} unique ACs to process")
    
    # Initialize PART_NO
    df['PART_NO'] = ''
    
    # Process each AC
    total_matched = 0
    total_not_matched = 0
    
    for i, ac in enumerate(ac_list, 1):
        print(f"\n{'='*70}")
        print(f"AC {i}/{len(ac_list)}: {ac['name']} ({ac['code']})")
        print(f"{'='*70}")
        
        # Get rows for this AC
        ac_mask = df['Selected AC'] == ac['name']
        ac_rows = df[ac_mask]
        print(f"  📊 Rows: {len(ac_rows)}")
        
        # Download file
        print(f"  📥 Downloading {ac['file_name']}...")
        file_path = download_sharepoint_file(ac['file_name'], TEMP_DIR)
        
        if not file_path or not os.path.exists(file_path):
            print(f"  ⚠️  File not found, trying CSV...")
            csv_name = ac['file_name'].replace('.xlsx', '.csv')
            file_path = download_sharepoint_file(csv_name, TEMP_DIR)
        
        if not file_path or not os.path.exists(file_path):
            print(f"  ❌ Could not download file for {ac['name']}")
            total_not_matched += len(ac_rows)
            continue
        
        # Load master data
        print(f"  📖 Loading master data...")
        phone_to_part = load_master_data(file_path)
        print(f"  ✅ Loaded {len(phone_to_part)} mappings")
        
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
            print(f"  🗑️  Deleted file to save space")
        except:
            pass
        
        print(f"\n  📈 Progress: {i}/{len(ac_list)} ACs | Matched: {total_matched} | Not matched: {total_not_matched}")
    
    # Save output
    print(f"\n{'='*70}")
    print(f"💾 Saving output...")
    df.to_csv(output_csv, index=False)
    
    # Cleanup
    try:
        import shutil
        shutil.rmtree(TEMP_DIR)
    except:
        pass
    
    # Summary
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"{'='*70}")
    print(f"Total: {len(df)}")
    print(f"✅ Matched: {total_matched}")
    print(f"❌ Not matched: {total_not_matched}")
    print(f"📊 Rate: {(total_matched/len(df)*100):.2f}%")
    print(f"💾 Saved: {output_csv}")
    print(f"{'='*70}")

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 add_part_no_sharepoint.py <input_csv> <output_csv>")
        sys.exit(1)
    
    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    
    if not os.path.exists(input_csv):
        print(f"Error: {input_csv} not found")
        sys.exit(1)
    
    try:
        process_csv_efficiently(input_csv, output_csv)
    except KeyboardInterrupt:
        print("\n\n⚠️  Interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

