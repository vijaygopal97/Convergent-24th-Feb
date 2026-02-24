#!/usr/bin/env python3
"""
Trim Excel file to specified number of rows
"""
import pandas as pd
import sys

if len(sys.argv) != 3:
    print("Usage: python3 trim_excel.py <excel_path> <max_rows>")
    sys.exit(1)

excel_path = sys.argv[1]
max_rows = int(sys.argv[2])

# Read Excel file
df = pd.read_excel(excel_path)

original_rows = len(df)
print(f"  - Original rows: {original_rows}")

# Trim to max_rows
df_trimmed = df.head(max_rows)

trimmed_rows = len(df_trimmed)
print(f"  - Trimmed rows: {trimmed_rows}")

# Save back to Excel
df_trimmed.to_excel(excel_path, index=False, engine='openpyxl')
print("✅ Excel trimmed successfully")

























































