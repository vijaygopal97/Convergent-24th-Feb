#!/usr/bin/env python3
"""
Add PART_NO to CATI responses report - Local Windows Version

This script processes the CSV and adds PART_NO by matching phone numbers
with master data files in a local directory.

Usage:
    python add_part_no_local.py input.csv output.csv [master_data_dir] [ac_json_path]
"""

import pandas as pd
import sys
import os
import json
import re
from pathlib import Path

def load_ac_mapping(ac_json_path):
    """Load AC mappings from JSON file"""
    try:
        with open(ac_json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        wb_acs = data['states']['West Bengal']['assemblyConstituencies']
        ac_name_to_code = {ac['acName']: ac['acCode'] for ac in wb_acs}
        return ac_name_to_code
    except Exception as e:
        print(f"❌ Error loading AC mapping from {ac_json_path}: {e}")
        return {}

def normalize_phone(phone):
    """
    Normalize phone number - remove all non-digits and handle country codes
    
    Handles:
    - +91 prefix (e.g., +919876543210 -> 9876543210)
    - 91 prefix (e.g., 919876543210 -> 9876543210)
    - 0 prefix (e.g., 09876543210 -> 9876543210)
    - Leading/trailing spaces
    - Non-digit characters
    - Float values (e.g., 7908938513.0 -> 7908938513)
    """
    if pd.isna(phone):
        return None
    
    # Handle float values - convert to int first to avoid scientific notation
    # and preserve all digits, then to string
    if isinstance(phone, (float, int)):
        # Convert float to int to remove decimal point, then to string
        # This preserves all digits even for large numbers
        try:
            phone_str = str(int(phone))
        except (ValueError, OverflowError):
            phone_str = str(phone).rstrip('0').rstrip('.')  # Remove trailing .0
    else:
        # Convert to string and strip whitespace
        phone_str = str(phone).strip()
    
    # Remove all non-digits
    digits_only = re.sub(r'\D', '', phone_str)
    
    if not digits_only:
        return None
    
    # Handle country code prefixes
    # If number starts with 91 and has 12 digits (91 + 10-digit number), remove 91
    if len(digits_only) == 12 and digits_only.startswith('91'):
        digits_only = digits_only[2:]  # Remove '91' prefix
    
    # Handle numbers starting with 0 (common in India, e.g., 09876543210)
    if len(digits_only) == 11 and digits_only.startswith('0'):
        digits_only = digits_only[1:]  # Remove leading '0'
    
    # Only return if we have a valid 10-digit number
    if len(digits_only) == 10 and digits_only.isdigit():
        return digits_only
    
    # If it's longer than 10 digits, take the last 10 (in case of extra prefixes)
    if len(digits_only) > 10:
        return digits_only[-10:]
    
    # If it's less than 10 digits, it's invalid
    return None

def format_ac_code(ac_code):
    """Format AC code to number without leading zeros (e.g., WB001 -> 1, WB023 -> 23)"""
    if ac_code.startswith('WB'):
        num = ac_code[2:].lstrip('0') or '0'
        return num  # Return without zero-padding (e.g., "23" not "023")
    return str(int(ac_code)) if ac_code.isdigit() else ac_code

def load_master_data(file_path):
    """Load master data file and create phone to PART_NO mapping"""
    if not file_path or not os.path.exists(file_path):
        return {}
    
    try:
        # Read file based on extension
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path, engine='openpyxl')
        elif file_path.endswith('.csv'):
            # Check if file is actually HTML (common with SharePoint downloads)
            try:
                with open(file_path, 'rb') as f:
                    first_bytes = f.read(500)
                    first_text = first_bytes.decode('utf-8', errors='ignore').lower()
                    if '<html' in first_text or '<!doctype' in first_text or 'error' in first_text[:200]:
                        print(f"  ⚠️  File appears to be HTML/error page, not CSV")
                        print(f"     First 200 chars: {first_text[:200]}")
                        return {}
            except:
                pass
            
            # Try different encodings and methods
            # Note: Files appear to have UTF-8 BOM (efbbbf), so use utf-8-sig
            df = None
            last_error = None
            
            # First try with C engine (faster, supports low_memory) and UTF-8-sig (handles BOM)
            try:
                df = pd.read_csv(file_path, encoding='utf-8-sig', on_bad_lines='skip', engine='c', low_memory=False, sep=',')
            except Exception as e:
                last_error = str(e)
                # Try other encodings with C engine
                for encoding in ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']:
                    try:
                        df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='c', low_memory=False, sep=',')
                        break
                    except Exception as e2:
                        last_error = str(e2)
                        continue
                
                # If C engine fails, try with python engine (but without low_memory)
                if df is None:
                    try:
                        df = pd.read_csv(file_path, encoding='utf-8-sig', on_bad_lines='skip', engine='python', sep=',')
                    except Exception as e3:
                        last_error = str(e3)
                        # Try other encodings with python engine
                        for encoding in ['utf-8', 'latin-1', 'cp1252']:
                            try:
                                df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='python', sep=',')
                                break
                            except:
                                continue
                
                # If still failed, try with different separators
                if df is None:
                    for sep in [';', '\t', '|']:
                        for encoding in ['utf-8-sig', 'utf-8', 'latin-1', 'cp1252']:
                            try:
                                df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='c', low_memory=False, sep=sep)
                                break
                            except:
                                try:
                                    df = pd.read_csv(file_path, encoding=encoding, on_bad_lines='skip', engine='python', sep=sep)
                                    break
                                except:
                                    continue
                        if df is not None:
                            break
            
            if df is None:
                print(f"  ⚠️  Could not read CSV with any encoding")
                print(f"     Last error: {last_error}")
                print(f"     File size: {os.path.getsize(file_path)} bytes")
                return {}
        else:
            print(f"  ⚠️  Unsupported file type: {file_path}")
            return {}
        
        # Find phone and PART_NO columns (case-insensitive, flexible matching)
        phone_col = None
        part_no_col = None
        
        # Print available columns for debugging
        print(f"  📋 Available columns: {list(df.columns)[:10]}..." if len(df.columns) > 10 else f"  📋 Available columns: {list(df.columns)}")
        
        for col in df.columns:
            col_lower = str(col).lower().strip().replace('_', '').replace(' ', '').replace('-', '')
            # Look for phone/mobile columns - check for common patterns
            if not phone_col:
                if any(x in col_lower for x in ['phone', 'mobile', 'contact', 'mobileno', 'tel', 'cell']):
                    phone_col = col
                # Also check for MOBILE_NO, MOBILE_NO_V1, etc.
                elif 'mobileno' in col_lower or 'mobil' in col_lower:
                    phone_col = col
            # Look for PART_NO column
            if not part_no_col:
                if any(x in col_lower for x in ['partno', 'part_no', 'partnumber', 'partnum']):
                    part_no_col = col
                # Also check exact match
                elif col_lower == 'partno' or col_lower == 'part_no':
                    part_no_col = col
        
        if not phone_col:
            print(f"  ⚠️  Phone column not found. Available columns: {list(df.columns)}")
            print(f"     Looking for columns containing: phone, mobile, contact, mobileno, tel, cell")
            return {}
        if not part_no_col:
            print(f"  ⚠️  PART_NO column not found. Available columns: {list(df.columns)}")
            print(f"     Looking for columns containing: partno, part_no, partnumber, partnum")
            return {}
        
        print(f"  ✅ Found phone column: {phone_col}")
        print(f"  ✅ Found PART_NO column: {part_no_col}")
        
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
        print(f"  ❌ Error loading master data: {e}")
        return {}

def process_csv(input_csv, output_csv, master_data_dir, ac_json_path):
    """Process CSV and add PART_NO column"""
    print("=" * 70)
    print("ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    
    # Load AC mappings
    print("\n📖 Loading AC mappings...")
    ac_name_to_code = load_ac_mapping(ac_json_path)
    if not ac_name_to_code:
        print("❌ Failed to load AC mappings. Exiting.")
        sys.exit(1)
    print(f"✅ Loaded {len(ac_name_to_code)} AC mappings")
    
    # Read input CSV
    print(f"\n📖 Reading input CSV: {input_csv}")
    try:
        # Read phone number column as string to preserve leading zeros and avoid float conversion
        df = pd.read_csv(input_csv, encoding='utf-8', low_memory=False, 
                        dtype={'Respondent Contact Number': str})
    except:
        # Try other encodings
        for encoding in ['latin-1', 'iso-8859-1', 'cp1252']:
            try:
                df = pd.read_csv(input_csv, encoding=encoding, low_memory=False,
                                dtype={'Respondent Contact Number': str})
                break
            except:
                continue
        else:
            print("❌ Could not read input CSV with any encoding")
            sys.exit(1)
    
    print(f"✅ Loaded {len(df)} rows")
    
    # Check required columns
    if 'Selected AC' not in df.columns:
        print(f"❌ Column 'Selected AC' not found. Available columns: {list(df.columns)}")
        sys.exit(1)
    if 'Respondent Contact Number' not in df.columns:
        print(f"❌ Column 'Respondent Contact Number' not found. Available columns: {list(df.columns)}")
        sys.exit(1)
    
    # Get unique ACs
    unique_ac_names = df['Selected AC'].dropna().unique()
    ac_list = []
    
    for ac_name in unique_ac_names:
        ac_code = ac_name_to_code.get(ac_name)
        if ac_code:
            ac_num = format_ac_code(ac_code)  # e.g., "23" for WB023
            # Try both formats: ac23.csv and ac023.csv
            ac_num_padded = ac_num.zfill(3)  # e.g., "023" for zero-padded format
            ac_list.append({
                'name': ac_name,
                'code': ac_code,
                'num': ac_num,
                'files': [
                    f'ac{ac_num}.xlsx',      # ac23.xlsx (no padding)
                    f'ac{ac_num}.csv',        # ac23.csv (no padding)
                    f'ac{ac_num_padded}.xlsx', # ac023.xlsx (with padding)
                    f'ac{ac_num_padded}.csv'  # ac023.csv (with padding)
                ]
            })
        else:
            print(f"  ⚠️  AC code not found for: {ac_name}")
    
    ac_list.sort(key=lambda x: int(x['num']))
    print(f"✅ Found {len(ac_list)} unique ACs to process")
    
    # Initialize PART_NO column
    df['PART_NO'] = ''
    
    total_matched = 0
    
    # Process each AC
    for i, ac in enumerate(ac_list, 1):
        print(f"\n{'='*70}")
        print(f"AC {i}/{len(ac_list)}: {ac['name']} ({ac['code']})")
        
        # Filter rows for this AC
        ac_mask = df['Selected AC'] == ac['name']
        ac_rows = df[ac_mask]
        print(f"  📊 Rows for this AC: {len(ac_rows)}")
        
        # Find master data file
        file_path = None
        for file_name in ac['files']:
            local_path = os.path.join(master_data_dir, file_name)
            if os.path.exists(local_path):
                file_path = local_path
                print(f"  ✅ Found master data: {file_name}")
                break
        
        if not file_path:
            print(f"  ⚠️  Master data file not found (tried: {', '.join(ac['files'])})")
            continue
        
        # Load master data
        phone_to_part = load_master_data(file_path)
        if not phone_to_part:
            print(f"  ⚠️  No phone-to-PART_NO mappings created from master data")
            # Try to provide more info about the file
            if os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                print(f"     File exists, size: {file_size} bytes")
                if file_size > 0:
                    # Try to read first few lines as text to see what's in it
                    try:
                        with open(file_path, 'rb') as f:
                            first_bytes = f.read(200)
                            print(f"     First 200 bytes (hex): {first_bytes[:200].hex()}")
                            # Try to decode as text
                            for enc in ['utf-8', 'latin-1', 'cp1252']:
                                try:
                                    text = first_bytes.decode(enc)
                                    print(f"     First 100 chars ({enc}): {text[:100]}")
                                    break
                                except:
                                    continue
                    except Exception as e:
                        print(f"     Could not read file preview: {e}")
            continue
        
        print(f"  ✅ Created {len(phone_to_part)} phone-to-PART_NO mappings")
        
        # Debug: Show sample phone numbers from master data
        if phone_to_part:
            sample_phones = list(phone_to_part.keys())[:5]
            print(f"  📱 Sample normalized phones from master data: {sample_phones}")
        
        # Debug: Show sample phone numbers from report
        sample_report_phones = []
        for idx in ac_rows.index[:5]:
            original_phone = df.at[idx, 'Respondent Contact Number']
            normalized = normalize_phone(original_phone)
            if normalized:
                sample_report_phones.append(f"{original_phone} -> {normalized}")
        if sample_report_phones:
            print(f"  📱 Sample report phones (original -> normalized):")
            for phone_info in sample_report_phones:
                print(f"     {phone_info}")
        
        # Match and fill PART_NO
        matched = 0
        unmatched_samples = []
        for idx in ac_rows.index:
            phone = normalize_phone(df.at[idx, 'Respondent Contact Number'])
            if phone:
                if phone in phone_to_part:
                    df.at[idx, 'PART_NO'] = phone_to_part[phone]
                    matched += 1
                elif len(unmatched_samples) < 3:
                    # Collect a few unmatched samples for debugging
                    original = df.at[idx, 'Respondent Contact Number']
                    unmatched_samples.append(f"{original} -> {phone}")
        
        # Show unmatched samples if any
        if unmatched_samples and matched == 0:
            print(f"  ⚠️  Sample unmatched phones (original -> normalized):")
            for phone_info in unmatched_samples:
                print(f"     {phone_info}")
            print(f"  💡 Tip: Check if master data phones have different format (e.g., with/without 91 prefix)")
        
        print(f"  ✅ Matched {matched}/{len(ac_rows)} rows ({matched/len(ac_rows)*100:.1f}%)")
        total_matched += matched
        
        print(f"\n  📈 Overall Progress: {i}/{len(ac_list)} | Total Matched: {total_matched}")
    
    # Save output
    print(f"\n💾 Saving output CSV: {output_csv}")
    df.to_csv(output_csv, index=False, encoding='utf-8-sig')  # UTF-8 with BOM for Excel compatibility
    
    print(f"\n{'='*70}")
    print("COMPLETE")
    print(f"✅ Total Matched: {total_matched}/{len(df)} ({(total_matched/len(df)*100):.2f}%)")
    print(f"💾 Output saved to: {output_csv}")
    print(f"{'='*70}")

def find_ac_json():
    """Try to find assemblyConstituencies.json in common locations"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    possible_paths = [
        os.path.join(script_dir, 'assemblyConstituencies.json'),
        os.path.join(script_dir, '..', 'opine', 'backend', 'data', 'assemblyConstituencies.json'),
        os.path.join(script_dir, 'data', 'assemblyConstituencies.json'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            return path
    
    return None

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage:")
        print('  python "add_part_no_local.py" <input_csv> <output_csv> [master_data_dir] [ac_json_path]')
        print("\nExample:")
        print('  python "add_part_no_local.py" "input.csv" "output.csv" "master_data" "assemblyConstituencies.json"')
        print("\nArguments:")
        print("  input_csv        - Path to input CATI responses CSV")
        print("  output_csv       - Path to output CSV with PART_NO column")
        print("  master_data_dir  - Directory containing master data files (ac001.xlsx, ac002.csv, etc.)")
        print("                     Default: 'master_data' in script directory")
        print("  ac_json_path     - Path to assemblyConstituencies.json")
        print("                     Default: auto-detect or 'assemblyConstituencies.json' in script directory")
        sys.exit(1)
    
    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    
    # Get master data directory
    if len(sys.argv) > 3:
        master_data_dir = sys.argv[3]
    else:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        master_data_dir = os.path.join(script_dir, 'master_data')
    
    # Get AC JSON path
    if len(sys.argv) > 4:
        ac_json_path = sys.argv[4]
    else:
        ac_json_path = find_ac_json()
        if not ac_json_path:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            ac_json_path = os.path.join(script_dir, 'assemblyConstituencies.json')
    
    # Validate paths
    if not os.path.exists(input_csv):
        print(f"❌ Input CSV not found: {input_csv}")
        sys.exit(1)
    
    if not os.path.exists(master_data_dir):
        print(f"❌ Master data directory not found: {master_data_dir}")
        sys.exit(1)
    
    if not os.path.exists(ac_json_path):
        print(f"❌ AC JSON file not found: {ac_json_path}")
        print(f"   Please provide the path to assemblyConstituencies.json")
        sys.exit(1)
    
    # Process
    process_csv(input_csv, output_csv, master_data_dir, ac_json_path)
