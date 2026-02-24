#!/usr/bin/env python3
"""
Add PART_NO column to CATI responses report

This script:
1. Reads the CATI responses CSV
2. Maps AC names to AC codes
3. Loads master data files for each AC (from SharePoint or local)
4. Finds PART_NO for each phone number
5. Adds PART_NO column to the output CSV

Usage:
    python3 add_part_no_to_cati_report.py <input_csv> <output_csv> [master_data_dir]
"""

import pandas as pd
import sys
import os
import json
from pathlib import Path
import re

# Constants
AC_JSON_PATH = '/var/www/opine/backend/data/assemblyConstituencies.json'
DEFAULT_MASTER_DATA_DIR = '/var/www/Report-Generation/master_data'

def load_ac_mapping():
    """Load AC code to AC name mapping from JSON"""
    with open(AC_JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    wb_acs = data['states']['West Bengal']['assemblyConstituencies']
    
    # Create bidirectional maps
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
    # Remove all non-digit characters
    phone_clean = re.sub(r'\D', '', phone_str)
    return phone_clean

def format_ac_code_for_file(ac_code):
    """Format AC code for filename (WB001 -> 001, WB251 -> 251)"""
    if ac_code.startswith('WB'):
        return ac_code[2:]
    return ac_code.zfill(3)

def find_master_data_file(ac_code, master_data_dir):
    """Find master data file for an AC code"""
    ac_num = format_ac_code_for_file(ac_code)
    
    # Try different possible file patterns
    patterns = [
        f'ac{ac_num}.xlsx',
        f'ac{ac_num}.csv',
        f'AC{ac_num}.xlsx',
        f'AC{ac_num}.csv',
        f'WB{ac_num}.xlsx',
        f'WB{ac_num}.csv',
        f'ac{int(ac_num)}.xlsx',
        f'ac{int(ac_num)}.csv',
        # Also try with leading zeros removed
        f'ac{int(ac_num)}.xlsx',
        f'ac{int(ac_num)}.csv',
    ]
    
    # Also search in subdirectories
    search_paths = [master_data_dir]
    if os.path.exists(master_data_dir):
        for item in os.listdir(master_data_dir):
            item_path = os.path.join(master_data_dir, item)
            if os.path.isdir(item_path):
                search_paths.append(item_path)
    
    for search_path in search_paths:
        for pattern in patterns:
            file_path = os.path.join(search_path, pattern)
            if os.path.exists(file_path):
                return file_path
    
    return None

def load_master_data_for_ac(ac_code, master_data_dir):
    """Load master data file for an AC and create phone to PART_NO mapping"""
    file_path = find_master_data_file(ac_code, master_data_dir)
    
    if not file_path:
        print(f"  ⚠️  Master data file not found for {ac_code}")
        return {}
    
    try:
        # Try to read as Excel first
        if file_path.endswith('.xlsx'):
            df = pd.read_excel(file_path)
        else:
            df = pd.read_csv(file_path)
        
        print(f"  ✅ Loaded master data: {os.path.basename(file_path)} ({len(df)} rows)")
        
        # Find phone and PART_NO columns
        phone_col = None
        part_no_col = None
        
        # Common column name variations
        phone_cols = ['phone', 'Phone', 'PHONE', 'MOBILE_NO', 'mobile_no', 'Mobile No', 
                     'Contact Number', 'contact_number', 'Contact', 'contact']
        part_no_cols = ['PART_NO', 'part_no', 'Part No', 'PART NO', 'Part_No', 
                       'part number', 'Part Number', 'PART_NUMBER']
        
        for col in df.columns:
            col_lower = str(col).lower().strip()
            if not phone_col and any(pc.lower() in col_lower for pc in phone_cols):
                phone_col = col
            if not part_no_col and any(pnc.lower() in col_lower for pnc in part_no_cols):
                part_no_col = col
        
        if not phone_col:
            print(f"  ⚠️  Phone column not found in {file_path}")
            print(f"     Available columns: {list(df.columns)}")
            return {}
        
        if not part_no_col:
            print(f"  ⚠️  PART_NO column not found in {file_path}")
            print(f"     Available columns: {list(df.columns)}")
            return {}
        
        # Create phone to PART_NO mapping
        phone_to_part = {}
        for idx, row in df.iterrows():
            phone = normalize_phone(row[phone_col])
            if phone and phone not in phone_to_part:
                part_no = row[part_no_col]
                if pd.notna(part_no):
                    phone_to_part[phone] = str(part_no).strip()
        
        print(f"  ✅ Created mapping for {len(phone_to_part)} phone numbers")
        return phone_to_part
        
    except Exception as e:
        print(f"  ❌ Error loading {file_path}: {str(e)}")
        return {}

def process_csv_with_part_no(input_csv, output_csv, master_data_dir):
    """Process CSV and add PART_NO column"""
    print("=" * 70)
    print("ADD PART_NO TO CATI RESPONSES REPORT")
    print("=" * 70)
    print(f"Input CSV: {input_csv}")
    print(f"Output CSV: {output_csv}")
    print(f"Master Data Directory: {master_data_dir}")
    print("=" * 70)
    
    # Load AC mappings
    print("\n📖 Loading AC mappings...")
    ac_code_to_name, ac_name_to_code = load_ac_mapping()
    print(f"✅ Loaded {len(ac_name_to_code)} AC mappings")
    
    # Read input CSV in chunks to save memory
    print(f"\n📖 Reading input CSV: {input_csv}")
    chunk_size = 1000
    chunks = []
    total_rows = 0
    
    for chunk in pd.read_csv(input_csv, chunksize=chunk_size):
        chunks.append(chunk)
        total_rows += len(chunk)
    
    print(f"✅ Read {total_rows} rows in {len(chunks)} chunks")
    
    # Process each chunk
    print(f"\n📊 Processing chunks and adding PART_NO...")
    
    # Track which ACs we've loaded
    ac_master_data_cache = {}
    
    processed_chunks = []
    matched_count = 0
    not_matched_count = 0
    
    for chunk_idx, chunk in enumerate(chunks):
        print(f"\nProcessing chunk {chunk_idx + 1}/{len(chunks)} ({len(chunk)} rows)...")
        
        # Initialize PART_NO column
        chunk['PART_NO'] = ''
        
        # Get unique ACs in this chunk
        unique_ac_names = chunk['Selected AC'].dropna().unique()
        
        # Load master data for each unique AC
        for ac_name in unique_ac_names:
            if pd.isna(ac_name):
                continue
            
            # Get AC code
            ac_code = ac_name_to_code.get(ac_name)
            if not ac_code:
                print(f"  ⚠️  AC code not found for: {ac_name}")
                continue
            
            # Load master data if not already cached
            if ac_code not in ac_master_data_cache:
                print(f"\n  📂 Loading master data for {ac_name} ({ac_code})...")
                ac_master_data_cache[ac_code] = load_master_data_for_ac(ac_code, master_data_dir)
        
        # Match phone numbers to PART_NO
        for idx, row in chunk.iterrows():
            phone = normalize_phone(row['Respondent Contact Number'])
            ac_name = row['Selected AC']
            
            if not phone or pd.isna(ac_name):
                not_matched_count += 1
                continue
            
            # Get AC code
            ac_code = ac_name_to_code.get(ac_name)
            if not ac_code:
                not_matched_count += 1
                continue
            
            # Look up PART_NO
            phone_to_part = ac_master_data_cache.get(ac_code, {})
            part_no = phone_to_part.get(phone)
            
            if part_no:
                chunk.at[idx, 'PART_NO'] = part_no
                matched_count += 1
            else:
                not_matched_count += 1
        
        processed_chunks.append(chunk)
        
        # Progress update
        if (chunk_idx + 1) % 10 == 0:
            print(f"  Progress: {chunk_idx + 1}/{len(chunks)} chunks, {matched_count} matched, {not_matched_count} not matched")
    
    # Combine all chunks
    print(f"\n📝 Combining chunks...")
    result_df = pd.concat(processed_chunks, ignore_index=True)
    
    # Save output
    print(f"\n💾 Saving output CSV: {output_csv}")
    result_df.to_csv(output_csv, index=False)
    
    # Print summary
    print("\n" + "=" * 70)
    print("PROCESSING COMPLETE")
    print("=" * 70)
    print(f"Total rows processed: {len(result_df)}")
    print(f"✅ Matched with PART_NO: {matched_count}")
    print(f"❌ Not matched: {not_matched_count}")
    print(f"📊 Match rate: {(matched_count / len(result_df) * 100):.2f}%")
    print(f"💾 Output saved to: {output_csv}")
    print("=" * 70)

def main():
    if len(sys.argv) < 3:
        print("Error: Insufficient arguments")
        print("\nUsage:")
        print("  python3 add_part_no_to_cati_report.py <input_csv> <output_csv> [master_data_dir]")
        print("\nExample:")
        print("  python3 add_part_no_to_cati_report.py input.csv output.csv")
        print("  python3 add_part_no_to_cati_report.py input.csv output.csv /path/to/master/data")
        sys.exit(1)
    
    input_csv = sys.argv[1]
    output_csv = sys.argv[2]
    master_data_dir = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_MASTER_DATA_DIR
    
    if not os.path.exists(input_csv):
        print(f"Error: Input CSV file not found: {input_csv}")
        sys.exit(1)
    
    if not os.path.exists(master_data_dir):
        print(f"⚠️  Warning: Master data directory not found: {master_data_dir}")
        print("   Please ensure master data files are available or specify the correct directory")
        response = input("Continue anyway? (y/n): ")
        if response.lower() != 'y':
            sys.exit(1)
    
    try:
        process_csv_with_part_no(input_csv, output_csv, master_data_dir)
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

